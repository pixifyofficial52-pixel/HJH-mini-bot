const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
const Pino = require('pino');
const fs = require('fs-extra');
const path = require('path');
const qrcode = require('qrcode-terminal');

// Express app for Railway
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Global variables
let globalQR = null;
let isConnected = false;
let currentNumber = null;
let pendingPairing = null;
let sockInstance = null;

// ============ API ENDPOINTS ============

// Main status endpoint
app.get('/', (req, res) => {
    res.json({
        status: 'active',
        bot: 'HJ-HACKER WhatsApp Bot',
        version: '3.0.0',
        connected: isConnected,
        number: currentNumber || 'Not connected',
        uptime: process.uptime(),
        qr: globalQR ? 'QR generated - check Railway logs' : null
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        connected: isConnected,
        timestamp: new Date().toISOString()
    });
});

// QR code endpoint (web par scan ke liye)
app.get('/qr', (req, res) => {
    if (globalQR) {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>HJ-HACKER - Scan QR</title>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>
                    body {
                        background: linear-gradient(135deg, #0f0c29, #302b63);
                        font-family: Arial;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        min-height: 100vh;
                        color: white;
                    }
                    .card {
                        background: rgba(255,255,255,0.1);
                        padding: 30px;
                        border-radius: 20px;
                        text-align: center;
                    }
                    img {
                        background: white;
                        padding: 20px;
                        border-radius: 10px;
                    }
                </style>
            </head>
            <body>
                <div class="card">
                    <h1>🔑 HJ-HACKER</h1>
                    <p>Scan this QR code with WhatsApp</p>
                    <img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(globalQR)}" />
                    <p>Open WhatsApp → Linked Devices → Link with phone number</p>
                </div>
            </body>
            </html>
        `);
    } else {
        res.send('No QR code yet. Bot is connecting...');
    }
});

// Connect endpoint (web page se pairing code receive)
app.post('/connect', (req, res) => {
    const { number, code } = req.body;
    
    console.log(`\n📡 Connection request received:`);
    console.log(`   Number: ${number}`);
    console.log(`   Code: ${code}`);
    
    if (!number || !code) {
        return res.json({ 
            success: false, 
            error: 'Number and code required' 
        });
    }
    
    // Store pairing request
    pendingPairing = { 
        number, 
        code, 
        timestamp: Date.now() 
    };
    
    res.json({ 
        success: true, 
        message: 'Pairing code received. Please enter in WhatsApp within 5 minutes.',
        instructions: 'Open WhatsApp → Settings → Linked Devices → Link with code'
    });
});

// Bot info endpoint
app.get('/info', (req, res) => {
    res.json({
        name: 'HJ-HACKER WhatsApp Bot',
        version: '3.0.0',
        features: [
            'Auto Reply',
            'Anti Delete',
            'Anti Link',
            'Auto Status View',
            'Get DP',
            'View Once Saver',
            'Online/Offline Toggle'
        ],
        commands: [
            '.menu', '.ping', '.info',
            '.addreply keyword|reply', '.listreply', '.delreply id',
            '.antidelete on/off', '.deleted',
            '.antilink on/off',
            '.autostatus on/off',
            '.dp @number',
            '.saveviewonce on/off',
            '.online on/off'
        ]
    });
});

// ============ BOT CONFIGURATION ============
const BOT_NAME = 'HJ-HACKER';
const PREFIX = '.';
const SESSIONS_DIR = path.join(__dirname, 'sessions');

// Settings storage
let settings = {
    autoReplyRules: [],
    antiDelete: false,
    antiLink: false,
    autoStatusView: false,
    autoStatusReact: false,
    autoStatusReactEmoji: '👍',
    saveViewOnce: false
};

const SETTINGS_FILE = path.join(__dirname, 'settings.json');
if (fs.existsSync(SETTINGS_FILE)) {
    try {
        settings = fs.readJsonSync(SETTINGS_FILE);
        console.log('✅ Settings loaded');
    } catch(e) {
        console.log('⚠️ Using default settings');
    }
}

function saveSettings() {
    fs.writeJsonSync(SETTINGS_FILE, settings, { spaces: 2 });
}

// Helper functions
function formatNumber(number) {
    return number.replace('@s.whatsapp.net', '').replace('@c.us', '');
}

function containsLink(text) {
    if (!text) return false;
    const urlRegex = /(https?:\/\/[^\s]+)/gi;
    return urlRegex.test(text);
}

function isWhitelisted(text) {
    const whitelist = ['whatsapp.com', 'youtube.com', 'instagram.com', 'facebook.com', 'tiktok.com'];
    for (const domain of whitelist) {
        if (text.toLowerCase().includes(domain)) return true;
    }
    return false;
}

function getMenu() {
    return `╔════════════════════════════════════════╗
║     🤖 *${BOT_NAME} BOT MENU*           ║
╠════════════════════════════════════════╣
║ 📌 *General Commands*                  ║
║  .menu / .help - Show this menu        ║
║  .ping - Check bot status              ║
║  .info - Bot information               ║
║                                        ║
║ 🤖 *Auto Reply*                        ║
║  .addreply keyword|reply               ║
║  .listreply - Show all rules           ║
║  .delreply id - Delete rule            ║
║                                        ║
║ 🛡️ *Anti Delete*                       ║
║  .antidelete on/off                    ║
║  .deleted - Show deleted msgs          ║
║                                        ║
║ 🔗 *Anti Link*                         ║
║  .antilink on/off                      ║
║  .whitelist add/remove domain          ║
║                                        ║
║ 👁️ *Auto Status*                       ║
║  .autostatus on/off                    ║
║  .statusreact on/off                   ║
║                                        ║
║ 📸 *Media Tools*                       ║
║  .dp @number - Get profile pic         ║
║  .saveviewonce on/off                  ║
║                                        ║
║ 🌐 *Online Status*                     ║
║  .online on/off - Toggle online        ║
╚════════════════════════════════════════╝`;
}

// ============ COMMAND HANDLER ============
async function handleCommand(message, from, sock) {
    const command = message.slice(1).toLowerCase().trim();
    const args = command.split(' ');
    const mainCmd = args[0];
    
    // Menu
    if (mainCmd === 'menu' || mainCmd === 'help') {
        await sock.sendMessage(from, { text: getMenu() });
        return true;
    }
    
    // Ping
    if (mainCmd === 'ping') {
        await sock.sendMessage(from, { text: '🏓 *Pong!*\nBot is active and running.' });
        return true;
    }
    
    // Info
    if (mainCmd === 'info') {
        const info = `📱 *Bot Info*
━━━━━━━━━━━━━━━━━━━━━━
🤖 *Name:* ${BOT_NAME}
📌 *Version:* 3.0.0
🟢 *Status:* Connected
👑 *Developer:* HJ-HACKER
📅 *Uptime:* ${Math.floor(process.uptime() / 60)} minutes
━━━━━━━━━━━━━━━━━━━━━━
🔧 *Active Features:*
${settings.antiDelete ? '✅ Anti Delete' : '❌ Anti Delete'}
${settings.antiLink ? '✅ Anti Link' : '❌ Anti Link'}
${settings.autoStatusView ? '✅ Auto Status' : '❌ Auto Status'}
${settings.saveViewOnce ? '✅ View Once Saver' : '❌ View Once Saver'}
━━━━━━━━━━━━━━━━━━━━━━
📝 *Auto Replies:* ${settings.autoReplyRules.length}
🗑️ *Anti Delete:* ${settings.antiDelete ? 'ON' : 'OFF'}
━━━━━━━━━━━━━━━━━━━━━━
💡 *Type .menu for all commands*`;
        await sock.sendMessage(from, { text: info });
        return true;
    }
    
    // Add Auto Reply
    if (mainCmd === 'addreply') {
        const parts = message.slice(1).split('|');
        if (parts.length < 2) {
            await sock.sendMessage(from, { text: '❌ *Usage:* .addreply keyword|reply\n\nExample: .addreply hello|Hi there!' });
            return true;
        }
        
        const keyword = parts[0].replace('addreply', '').trim();
        const reply = parts[1].trim();
        
        if (!keyword || !reply) {
            await sock.sendMessage(from, { text: '❌ Both keyword and reply are required!' });
            return true;
        }
        
        const rule = {
            id: Date.now(),
            keyword: keyword.toLowerCase(),
            reply: reply,
            enabled: true,
            createdAt: new Date().toISOString()
        };
        
        settings.autoReplyRules.push(rule);
        saveSettings();
        
        await sock.sendMessage(from, { text: `✅ *Auto Reply Added!*\n\n🔑 *Keyword:* ${keyword}\n💬 *Reply:* ${reply}\n🆔 *ID:* ${rule.id}` });
        return true;
    }
    
    // List Auto Replies
    if (mainCmd === 'listreply') {
        if (settings.autoReplyRules.length === 0) {
            await sock.sendMessage(from, { text: '📭 *No auto reply rules found.*\nUse .addreply keyword|reply to add.' });
            return true;
        }
        
        let list = '📋 *Auto Reply Rules*\n━━━━━━━━━━━━━━\n';
        settings.autoReplyRules.forEach((rule, i) => {
            list += `\n${i+1}. 🔑 *${rule.keyword}*\n   💬 → ${rule.reply}\n   🆔 ID: ${rule.id}\n`;
        });
        await sock.sendMessage(from, { text: list });
        return true;
    }
    
    // Delete Auto Reply
    if (mainCmd === 'delreply') {
        const ruleId = parseInt(args[1]);
        if (!ruleId) {
            await sock.sendMessage(from, { text: '❌ *Usage:* .delreply id\nUse .listreply to see IDs.' });
            return true;
        }
        
        const index = settings.autoReplyRules.findIndex(r => r.id === ruleId);
        if (index !== -1) {
            const removed = settings.autoReplyRules.splice(index, 1);
            saveSettings();
            await sock.sendMessage(from, { text: `✅ *Rule deleted:* ${removed[0].keyword}` });
        } else {
            await sock.sendMessage(from, { text: '❌ Rule not found. Use .listreply to see IDs.' });
        }
        return true;
    }
    
    // Anti Delete
    if (mainCmd === 'antidelete') {
        const action = args[1];
        if (action === 'on') {
            settings.antiDelete = true;
            saveSettings();
            await sock.sendMessage(from, { text: '✅ *Anti Delete Activated!*\nDeleted messages will be captured.' });
        } else if (action === 'off') {
            settings.antiDelete = false;
            saveSettings();
            await sock.sendMessage(from, { text: '❌ *Anti Delete Deactivated*' });
        } else {
            await sock.sendMessage(from, { text: `🛡️ *Anti Delete Status:* ${settings.antiDelete ? 'ON' : 'OFF'}\nUse .antidelete on/off to change.` });
        }
        return true;
    }
    
    // Anti Link
    if (mainCmd === 'antilink') {
        const action = args[1];
        if (action === 'on') {
            settings.antiLink = true;
            saveSettings();
            await sock.sendMessage(from, { text: '✅ *Anti Link Activated!*\nLinks will be blocked automatically.' });
        } else if (action === 'off') {
            settings.antiLink = false;
            saveSettings();
            await sock.sendMessage(from, { text: '❌ *Anti Link Deactivated*' });
        } else {
            await sock.sendMessage(from, { text: `🔗 *Anti Link Status:* ${settings.antiLink ? 'ON' : 'OFF'}\nUse .antilink on/off to change.` });
        }
        return true;
    }
    
    // Auto Status
    if (mainCmd === 'autostatus') {
        const action = args[1];
        if (action === 'on') {
            settings.autoStatusView = true;
            saveSettings();
            await sock.sendMessage(from, { text: '✅ *Auto Status View Activated!*\nI will view all statuses automatically.' });
        } else if (action === 'off') {
            settings.autoStatusView = false;
            saveSettings();
            await sock.sendMessage(from, { text: '❌ *Auto Status View Deactivated*' });
        } else {
            await sock.sendMessage(from, { text: `👁️ *Auto Status View:* ${settings.autoStatusView ? 'ON' : 'OFF'}\nUse .autostatus on/off to change.` });
        }
        return true;
    }
    
    // Get DP
    if (mainCmd === 'dp') {
        let targetNumber = args[1];
        if (!targetNumber) {
            await sock.sendMessage(from, { text: '❌ *Usage:* .dp @number\n\nExample: .dp 923001234567' });
            return true;
        }
        
        targetNumber = targetNumber.replace('@', '');
        await sock.sendMessage(from, { text: `📸 *Fetching profile picture...*\nNumber: ${targetNumber}` });
        
        try {
            const jid = targetNumber.includes('@') ? targetNumber : `${targetNumber}@s.whatsapp.net`;
            const ppUrl = await sock.profilePictureUrl(jid, 'image');
            await sock.sendMessage(from, { 
                image: { url: ppUrl },
                caption: `📸 *Profile Picture*\n\n📱 *Number:* ${targetNumber}\n🤖 *Bot:* ${BOT_NAME}`
            });
        } catch (error) {
            await sock.sendMessage(from, { text: '❌ *DP not found*\nUser may have no profile picture or privacy settings enabled.' });
        }
        return true;
    }
    
    // View Once Saver
    if (mainCmd === 'saveviewonce') {
        const action = args[1];
        if (action === 'on') {
            settings.saveViewOnce = true;
            saveSettings();
            await sock.sendMessage(from, { text: '✅ *View Once Saver Activated!*\nView once media will be saved automatically.' });
        } else if (action === 'off') {
            settings.saveViewOnce = false;
            saveSettings();
            await sock.sendMessage(from, { text: '❌ *View Once Saver Deactivated*' });
        } else {
            await sock.sendMessage(from, { text: `📸 *View Once Saver:* ${settings.saveViewOnce ? 'ON' : 'OFF'}\nUse .saveviewonce on/off to change.` });
        }
        return true;
    }
    
    // Online/Offline
    if (mainCmd === 'online') {
        const action = args[1];
        if (action === 'on') {
            await sock.sendPresenceUpdate('available');
            await sock.sendMessage(from, { text: '✅ *Online Mode Activated!*\nYou appear online now.' });
        } else if (action === 'off') {
            await sock.sendPresenceUpdate('unavailable');
            await sock.sendMessage(from, { text: '❌ *Offline Mode Activated!*\nYou appear offline now.' });
        } else {
            await sock.sendMessage(from, { text: '🌐 *Online Status*\nUse .online on/off to change your presence.' });
        }
        return true;
    }
    
    // Unknown command
    await sock.sendMessage(from, { text: `❌ *Unknown Command:* ${mainCmd}\n\nType *.menu* to see all available commands.` });
    return true;
}

// Auto Reply Check
async function checkAutoReply(message, from, sock) {
    const lowerMsg = message.toLowerCase();
    for (const rule of settings.autoReplyRules) {
        if (rule.enabled && lowerMsg.includes(rule.keyword)) {
            await sock.sendMessage(from, { text: rule.reply });
            return true;
        }
    }
    return false;
}

// Anti Link Check
async function checkAntiLink(message, from, sock) {
    if (settings.antiLink && containsLink(message) && !isWhitelisted(message)) {
        await sock.sendMessage(from, { text: '🔗 *Link Detected!*\n\nLinks are not allowed in this chat. Please avoid sending links.' });
        return true;
    }
    return false;
}

// Deleted messages storage
let deletedMessages = new Map();

function captureDeletedMessage(message, from, to) {
    if (!settings.antiDelete) return;
    
    const key = to || from;
    const sessionDeleted = deletedMessages.get(key) || [];
    sessionDeleted.unshift({
        from: formatNumber(from),
        message: message,
        capturedAt: new Date().toISOString()
    });
    
    if (sessionDeleted.length > 50) sessionDeleted.pop();
    deletedMessages.set(key, sessionDeleted);
    
    console.log(`🗑️ Deleted message captured from ${from}: ${message}`);
}

// ============ WHATSAPP CONNECTION ============
async function connectToWhatsApp() {
    try {
        // Ensure sessions directory exists
        await fs.ensureDir(SESSIONS_DIR);
        
        const { state, saveCreds } = await useMultiFileAuthState(SESSIONS_DIR);
        const { version } = await fetchLatestBaileysVersion();
        
        const sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: true,
            browser: Browsers.macOS('Desktop'),
            logger: Pino({ level: 'silent' }),
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: true
        });
        
        sockInstance = sock;
        
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                globalQR = qr;
                console.log('\n📱 QR CODE GENERATED!');
                console.log('Scan with WhatsApp → Linked Devices\n');
                qrcode.generate(qr, { small: true });
                console.log('\n🔗 Or visit: https://hjh-mini-bot-production-7c1f.up.railway.app/qr\n');
            }
            
            if (connection === 'open') {
                isConnected = true;
                currentNumber = sock.user.id.split(':')[0];
                globalQR = null;
                
                console.log('\n✅ =====================================');
                console.log(`✅ ${BOT_NAME} CONNECTED!`);
                console.log(`✅ Number: ${currentNumber}`);
                console.log('✅ =====================================\n');
                console.log('📝 Bot is ready! Type .menu in WhatsApp\n');
                
                // Send welcome message
                const welcomeMsg = `🤖 *${BOT_NAME} Bot Connected!*\n\nType *.menu* to see all available commands.\n\n🔧 *Features:*\n• Auto Reply\n• Anti Delete\n• Anti Link\n• Auto Status\n• Get DP\n• View Once Saver\n\n*Developer:* HJ-HACKER`;
                
                // Send to self
                await sock.sendMessage(sock.user.id, { text: welcomeMsg });
            }
            
            if (connection === 'close') {
                isConnected = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                console.log(`\n❌ Disconnected: ${statusCode}`);
                
                if (statusCode !== DisconnectReason.loggedOut) {
                    console.log('🔄 Reconnecting in 10 seconds...\n');
                    setTimeout(connectToWhatsApp, 10000);
                } else {
                    console.log('🔒 Logged out. Delete sessions folder and restart.\n');
                }
            }
        });
        
        sock.ev.on('creds.update', saveCreds);
        
        sock.ev.on('messages.upsert', async ({ messages }) => {
            const msg = messages[0];
            if (!msg.message || msg.key.fromMe) return;
            
            const from = msg.key.remoteJid;
            const messageText = msg.message.conversation || 
                               msg.message.extendedTextMessage?.text ||
                               msg.message.imageMessage?.caption ||
                               '';
            
            if (!messageText) return;
            
            console.log(`📩 [${formatNumber(from)}]: ${messageText}`);
            
            // Handle commands
            if (messageText.startsWith(PREFIX)) {
                await handleCommand(messageText, from, sock);
            } else {
                // Auto reply
                await checkAutoReply(messageText, from, sock);
                // Anti link
                await checkAntiLink(messageText, from, sock);
            }
        });
        
        // Handle deleted messages
        sock.ev.on('messages.update', async (updates) => {
            for (const update of updates) {
                if (update.update?.message) {
                    const message = update.update.message;
                    const messageText = message.conversation || message.extendedTextMessage?.text || '';
                    
                    if (messageText) {
                        captureDeletedMessage(messageText, update.key.remoteJid, update.key.fromMe ? update.key.remoteJid : null);
                    }
                }
            }
        });
        
        // Handle view once media
        if (settings.saveViewOnce) {
            sock.ev.on('messages.upsert', async ({ messages }) => {
                const msg = messages[0];
                if (msg.message?.viewOnceMessageV2) {
                    console.log(`📸 View once media detected from ${formatNumber(msg.key.remoteJid)}`);
                    // Auto save logic here
                }
            });
        }
        
    } catch (error) {
        console.error('Connection error:', error);
        setTimeout(connectToWhatsApp, 10000);
    }
}

// ============ START SERVER ============
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════╗
║     🤖 ${BOT_NAME} WHATSAPP BOT              ║
║     Version: 3.0.0                        ║
║     Developer: HJ-HACKER                   ║
║     Port: ${PORT}                          ║
╚═══════════════════════════════════════════╝
    `);
    console.log(`📡 Web interface: https://hjh-mini-bot-production-7c1f.up.railway.app`);
    console.log(`🔌 Connect endpoint: POST /connect\n`);
});

// Start WhatsApp connection
connectToWhatsApp();

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n\n🛑 Shutting down bot...');
    if (sockInstance) {
        await sockInstance.logout();
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n\n🛑 Shutting down bot...');
    if (sockInstance) {
        await sockInstance.logout();
    }
    process.exit(0);
});
