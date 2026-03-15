const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    downloadContentFromMessage,
    Browsers,
    makeInMemoryStore
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const P = require('pino');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Create auth directory
const authDir = path.join(__dirname, 'auth');
if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

// Store for deleted messages
const antiDeleteStore = new Map();
const statusReactions = ['👍', '❤️', '🔥', '👏', '😊', '😍', '🤩', '🎉', '💯', '✨'];

class WhatsAppBot {
    constructor(phoneNumber, onStatusChange) {
        this.phoneNumber = phoneNumber;
        this.onStatusChange = onStatusChange;
        this.sock = null;
        this.isConnected = false;
        this.store = makeInMemoryStore({ logger: P({ level: 'silent' }) });
    }

    async initialize() {
        try {
            const { state, saveCreds } = await useMultiFileAuthState(`auth/${this.phoneNumber}`);
            
            this.sock = makeWASocket({
                auth: state,
                printQRInTerminal: false,
                logger: P({ level: 'silent' }),
                browser: Browsers.macOS('Desktop'),
                syncFullHistory: true,
                generateHighQualityLinkPreview: true
            });

            this.store.bind(this.sock.ev);

            // Connection handler
            this.sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === 'connecting') {
                    console.log('🔄 Connecting...');
                    this.onStatusChange?.('connecting');
                }

                if (connection === 'open') {
                    this.isConnected = true;
                    console.log('✅ Bot connected!');
                    this.onStatusChange?.('connected');
                    await this.sendWelcomeMessage();
                }

                if (connection === 'close') {
                    this.isConnected = false;
                    const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
                    console.log('❌ Connection closed, reconnecting:', shouldReconnect);
                    this.onStatusChange?.('disconnected');
                    
                    if (shouldReconnect) {
                        setTimeout(() => this.initialize(), 5000);
                    }
                }
            });

            // Message handler
            this.sock.ev.on('messages.upsert', async ({ messages }) => {
                for (const msg of messages) {
                    await this.handleMessage(msg);
                }
            });

            // Status handler
            this.sock.ev.on('messages.update', async (updates) => {
                for (const update of updates) {
                    if (update.key.remoteJid === 'status@broadcast') {
                        await this.handleStatus(update);
                    }
                }
            });

            // Deleted messages handler
            this.sock.ev.on('messages.delete', (item) => {
                if (item.keys) {
                    for (const key of item.keys) {
                        if (key.id) {
                            const msg = this.store.loadMessage(key.remoteJid, key.id);
                            if (msg && msg.message) {
                                const text = msg.message.conversation || 
                                           msg.message.extendedTextMessage?.text || 
                                           '📎 Media message';
                                antiDeleteStore.set(key.id, {
                                    text,
                                    from: key.remoteJid,
                                    fromName: msg.pushName || 'Unknown',
                                    time: Date.now()
                                });
                                
                                setTimeout(() => antiDeleteStore.delete(key.id), 300000);
                            }
                        }
                    }
                }
            });

            // Credentials
            this.sock.ev.on('creds.update', saveCreds);

        } catch (error) {
            console.error('❌ Bot initialization error:', error);
            this.onStatusChange?.('error');
        }
    }

    async handleMessage(msg) {
        try {
            if (!msg.message || msg.key.fromMe) return;
            
            const messageType = Object.keys(msg.message)[0];
            const sender = msg.key.remoteJid;

            // Anti View Once
            if (messageType === 'viewOnceMessage') {
                await this.handleViewOnce(msg);
            }

            // Check for deleted message
            if (messageType === 'protocolMessage' && msg.message.protocolMessage.type === 0) {
                await this.handleDeletedMessage(msg);
            }

            // Handle commands
            const messageText = msg.message.conversation || 
                               msg.message.extendedTextMessage?.text ||
                               msg.message.imageMessage?.caption || '';

            if (messageText.startsWith('!')) {
                await this.handleCommand(msg, messageText);
            }

        } catch (error) {
            console.error('❌ Message handler error:', error);
        }
    }

    async handleViewOnce(msg) {
        try {
            const viewOnceMsg = msg.message.viewOnceMessage.message;
            const mediaType = Object.keys(viewOnceMsg)[0];
            
            if (['imageMessage', 'videoMessage'].includes(mediaType)) {
                const stream = await downloadContentFromMessage(viewOnceMsg[mediaType], mediaType.replace('Message', ''));
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }
                
                await this.sock.sendMessage(msg.key.remoteJid, {
                    [mediaType === 'imageMessage' ? 'image' : 'video']: buffer,
                    caption: '┌─── ⚠️ *ANTI VIEW ONCE* ───┐\n' +
                            '│                         │\n' +
                            '│  🔓 Message Saved!      │\n' +
                            '│  👤 User: ' + (msg.pushName || 'Unknown') + '\n' +
                            '└─────────────────────────┘',
                    mentions: [msg.key.participant || msg.key.remoteJid]
                });
            }
        } catch (error) {
            console.error('❌ View once error:', error);
        }
    }

    async handleDeletedMessage(msg) {
        try {
            const key = msg.message.protocolMessage.key;
            const deletedMsg = antiDeleteStore.get(key.id);
            
            if (deletedMsg) {
                await this.sock.sendMessage(key.remoteJid, {
                    text: `┌─── ⚠️ *ANTI DELETE* ───┐\n` +
                          `│                       │\n` +
                          `│  👤 User: @${(key.participant || key.remoteJid).split('@')[0]}\n` +
                          `│  💬 Message: ${deletedMsg.text}\n` +
                          `│  ⏰ Time: ${new Date(deletedMsg.time).toLocaleTimeString()}\n` +
                          `└───────────────────────┘`,
                    mentions: [key.participant || key.remoteJid]
                });
            }
        } catch (error) {
            console.error('❌ Anti delete error:', error);
        }
    }

    async handleStatus(update) {
        try {
            // Auto view
            await this.sock.readMessages([update.key]);
            
            // Auto react
            const randomReaction = statusReactions[Math.floor(Math.random() * statusReactions.length)];
            await this.sock.sendMessage(update.key.remoteJid, {
                react: {
                    text: randomReaction,
                    key: update.key
                }
            });
            
            console.log(`📱 Status viewed and reacted with ${randomReaction}`);
        } catch (error) {
            console.error('❌ Status handler error:', error);
        }
    }

    async handleCommand(msg, text) {
        const sender = msg.key.remoteJid;
        const args = text.slice(1).split(' ');
        const command = args[0].toLowerCase();
        const query = args.slice(1).join(' ');

        switch(command) {
            case 'ping':
                const start = Date.now();
                await this.sock.sendMessage(sender, { text: '🏓 *Pong!*' });
                const end = Date.now();
                await this.sock.sendMessage(sender, { 
                    text: `⚡ *Response Time:* ${end - start}ms` 
                });
                break;

            case 'menu':
                await this.sendMenu(sender);
                break;

            case 'help':
                await this.sendMenu(sender);
                break;

            case 'dp':
            case 'profile':
                let target = sender;
                if (query) {
                    const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
                    target = mentioned ? mentioned[0] : query.replace(/\D/g, '') + '@s.whatsapp.net';
                }
                
                try {
                    const ppUrl = await this.sock.profilePictureUrl(target, 'image');
                    const response = await axios.get(ppUrl, { responseType: 'arraybuffer' });
                    
                    await this.sock.sendMessage(sender, {
                        image: Buffer.from(response.data),
                        caption: `┌─── 📸 *PROFILE PICTURE* ───┐\n` +
                                `│                           │\n` +
                                `│  👤 User: @${target.split('@')[0]}\n` +
                                `│  📥 Downloaded Successfully\n` +
                                `│                           │\n` +
                                `└───────────────────────────┘`,
                        mentions: [target]
                    });
                } catch {
                    await this.sock.sendMessage(sender, { 
                        text: '❌ *No profile picture found*' 
                    });
                }
                break;

            case 'info':
                const uptime = process.uptime();
                const hours = Math.floor(uptime / 3600);
                const minutes = Math.floor((uptime % 3600) / 60);
                
                await this.sock.sendMessage(sender, {
                    text: `┌─── ℹ️ *BOT INFO* ───┐\n` +
                          `│                   │\n` +
                          `│  🤖 Name: ${process.env.BOT_NAME}\n` +
                          `│  ⚡ Status: Online\n` +
                          `│  ⏰ Uptime: ${hours}h ${minutes}m\n` +
                          `│  🛡️ Features: Active\n` +
                          `│                   │\n` +
                          `└───────────────────┘`
                });
                break;

            default:
                // Unknown command
                break;
        }
    }

    async sendMenu(jid) {
        const menu = `┌─── 🤖 *${process.env.BOT_NAME}* ───┐\n` +
                    `│                            │\n` +
                    `│  📱 *BASIC COMMANDS*       │\n` +
                    `│  🏓 !ping - Check bot      │\n` +
                    `│  📋 !menu - Show menu      │\n` +
                    `│  ℹ️ !info - Bot info       │\n` +
                    `│                            │\n` +
                    `│  🛡️ *ANTI FEATURES*         │\n` +
                    `│  ✓ Anti Delete Active      │\n` +
                    `│  ✓ Anti View Once Active   │\n` +
                    `│                            │\n` +
                    `│  📸 *MEDIA COMMANDS*        │\n` +
                    `│  📸 !dp - Get DP           │\n` +
                    `│                            │\n` +
                    `│  📱 *STATUS FEATURES*       │\n` +
                    `│  ✓ Auto Views              │\n` +
                    `│  ✓ Auto Reactions          │\n` +
                    `│                            │\n` +
                    `└────────────────────────────┘`;
        
        await this.sock.sendMessage(jid, { text: menu });
    }

    async sendWelcomeMessage() {
        try {
            await this.sock.sendMessage(this.phoneNumber + '@s.whatsapp.net', {
                text: `┌─── 🎉 *WELCOME TO ${process.env.BOT_NAME}* ───┐\n` +
                      `│                                          │\n` +
                      `│  ✅ *Successfully Connected!*            │\n` +
                      `│                                          │\n` +
                      `│  📱 *ACTIVE FEATURES*                    │\n` +
                      `│  🛡️ Anti Delete - Active                 │\n` +
                      `│  👁️ Anti View Once - Active              │\n` +
                      `│  📸 DP Download - Ready                  │\n` +
                      `│  👀 Status Views - Auto                  │\n` +
                      `│  ❤️ Status React - Auto                  │\n` +
                      `│                                          │\n` +
                      `│  📌 Send *!menu* for all commands        │\n` +
                      `│                                          │\n` +
                      `└──────────────────────────────────────────┘`
            });
        } catch (error) {
            console.error('❌ Welcome message error:', error);
        }
    }
}

async function startBot(phoneNumber, onStatusChange) {
    const bot = new WhatsAppBot(phoneNumber, onStatusChange);
    await bot.initialize();
    return bot;
}

module.exports = { startBot };
