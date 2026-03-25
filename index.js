const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
const Pino = require('pino');
const fs = require('fs-extra');
const path = require('path');
const qrcode = require('qrcode-terminal');

// Express app for Railway health check
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.json({
        status: 'active',
        bot: 'HJ-HACKER WhatsApp Bot',
        version: '3.0.0',
        connected: global.isConnected || false,
        number: global.currentNumber || 'Not connected',
        uptime: process.uptime()
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', connected: global.isConnected || false });
});

app.listen(PORT, () => {
    console.log(`✅ Web server running on port ${PORT}`);
});

// ============ BOT CONFIGURATION ============
const BOT_NAME = 'HJ-HACKER';
const BOT_VERSION = '3.0.0';
const PREFIX = '.';
const SESSIONS_DIR = path.join(__dirname, 'sessions');

// Global variables
global.isConnected = false;
global.currentNumber = null;
global.pairingCode = null;

// Settings
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
    settings = fs.readJsonSync(SETTINGS_FILE);
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
    const whitelist = ['whatsapp.com', 'youtube.com', 'instagram.com', 'facebook.com'];
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
        await sock.sendMessage(from, { text: '🏓 *Pong!*\nBot is active.' });
        return true;
    }
    
    // Info
    if (mainCmd === 'info') {
        const info = `📱 *Bot Info*
━━━━━━━━━━━━━━━━
🤖 *Name:* ${BOT_NAME}
📌 *Version:* ${BOT_VERSION}
🟢 *Status:* Connected
👑 *Developer:* HJ-HACKER
━━━━━━━━━━━━━━━━
🔧 *Features:*
${settings.antiDelete ? '✅ Anti Delete' : '❌ Anti Delete'}
${settings.antiLink ? '✅ Anti Link' : '❌ Anti Link'}
${settings.autoStatusView ? '✅ Auto Status' : '❌ Auto Status'}
📝 Auto Replies: ${settings.autoReplyRules.length}`;
        await sock.sendMessage(from, { text: info });
        return true;
    }
    
    // Add Auto Reply
    if (mainCmd === 'addreply') {
        const parts = message.slice(1).split('|');
        if (parts.length < 2) {
            await sock.sendMessage(from, { text: '❌ Usage: .addreply keyword|reply' });
            return true;
        }
        
        const keyword = parts[0].replace('addreply', '').trim();
        const reply = parts[1].trim();
        
        settings.autoReplyRules.push({
            id: Date.now(),
            keyword: keyword.toLowerCase(),
            reply: reply,
            enabled: true
        });
        saveSettings();
        
        await sock.sendMessage(from, { text: `✅ Auto Reply Added!\n🔑 ${keyword} → 💬 ${reply}` });
        return true;
    }
    
    // List Auto Replies
    if (mainCmd === 'listreply') {
        if (settings.autoReplyRules.length === 0) {
            await sock.sendMessage(from, { text: '📭 No auto reply rules.' });
            return true;
        }
        
        let list = '📋 *Auto Reply Rules*\n━━━━━━━━━━━━━━\n';
        settings.autoReplyRules.forEach((rule, i) => {
            list += `\n${i+1}. 🔑 *${rule.keyword}*\n   💬 → ${rule.reply}`;
        });
        await sock.sendMessage(from, { text: list });
        return true;
    }
    
    // Delete Auto Reply
    if (mainCmd === 'delreply') {
        const ruleId = parseInt(args[1]);
        if (!ruleId) {
            await sock.sendMessage(from, { text: '❌ Usage: .delreply id' });
            return true;
        }
        
        const index = settings.autoReplyRules.findIndex(r => r.id === ruleId);
        if (index !== -1) {
            const removed = settings.autoReplyRules.splice(index, 1);
            saveSettings();
            await sock.sendMessage(from, { text: `✅ Deleted: ${removed[0].keyword}` });
        } else {
            await sock.sendMessage(from, { text: '❌ Rule not found' });
        }
        return true;
    }
    
    // Anti Delete
    if (mainCmd === 'antidelete') {
        const action = args[1];
        if (action === 'on') {
            settings.antiDelete = true;
            saveSettings();
            await sock.sendMessage(from, { text: '✅ Anti Delete Activated!' });
        } else if (action === 'off') {
            settings.antiDelete = false;
            saveSettings();
            await sock.sendMessage(from, { text: '❌ Anti Delete Deactivated' });
        } else {
            await sock.sendMessage(from, { text: `🛡️ Anti Delete: ${settings.antiDelete ? 'ON' : 'OFF'}` });
        }
        return true;
    }
    
    // Anti Link
    if (mainCmd === 'antilink') {
        const action = args[1];
        if (action === 'on') {
            settings.antiLink = true;
            saveSettings();
            await sock.sendMessage(from, { text: '✅ Anti Link Activated!' });
        } else if (action === 'off') {
            settings.antiLink = false;
            saveSettings();
            await sock.sendMessage(from, { text: '❌ Anti Link Deactivated' });
        } else {
            await sock.sendMessage(from, { text: `🔗 Anti Link: ${settings.antiLink ? 'ON' : 'OFF'}` });
        }
        return true;
    }
    
    // Auto Status
    if (mainCmd === 'autostatus') {
        const action = args[1];
        if (action === 'on') {
            settings.autoStatusView = true;
            saveSettings();
            await sock.sendMessage(from, { text: '✅ Auto Status View Activated!' });
        } else if (action === 'off') {
            settings.autoStatusView = false;
            saveSettings();
            await sock.sendMessage(from, { text: '❌ Auto Status View Deactivated' });
        } else {
            await sock.sendMessage(from, { text: `👁️ Auto Status: ${settings.autoStatusView ? 'ON' : 'OFF'}` });
        }
        return true;
    }
    
    // Get DP
    if (mainCmd === 'dp') {
        let targetNumber = args[1];
        if (!targetNumber) {
            await sock.sendMessage(from, { text: '❌ Usage: .dp @number\nExample: .dp 923001234567' });
            return true;
        }
        
        targetNumber = targetNumber.replace('@', '');
        await sock.sendMessage(from, { text: `📸 Fetching DP for ${targetNumber}...` });
        
        try {
            const jid = `${targetNumber}@s.whatsapp.net`;
            const ppUrl = await sock.profilePictureUrl(jid, 'image');
            await sock.sendMessage(from, { 
                image: { url: ppUrl },
                caption: `📸 *Profile Picture*\n📱 ${targetNumber}`
            });
        } catch (error) {
            await sock.sendMessage(from, { text: '❌ DP not found or private' });
        }
        return true;
    }
    
    // Online/Offline
    if (mainCmd === 'online') {
        const action = args[1];
        if (action === 'on') {
            await sock.sendPresenceUpdate('available');
            await sock.sendMessage(from, { text: '✅ Online Mode Activated!' });
        } else if (action === 'off') {
            await sock.sendPresenceUpdate('unavailable');
            await sock.sendMessage(from, { text: '❌ Offline Mode Activated!' });
        } else {
            await sock.sendMessage(from, { text: '🌐 Usage: .online on/off' });
        }
        return true;
    }
    
    // Save View Once
    if (mainCmd === 'saveviewonce') {
        const action = args[1];
        if (action === 'on') {
            settings.saveViewOnce = true;
            saveSettings();
            await sock.sendMessage(from, { text: '✅ View Once Saver Activated!' });
        } else if (action === 'off') {
            settings.saveViewOnce = false;
            saveSettings();
            await sock.sendMessage(from, { text: '❌ View Once Saver Deactivated' });
        } else {
            await sock.sendMessage(from, { text: `📸 View Once Saver: ${settings.saveViewOnce ? 'ON' : 'OFF'}` });
        }
        return true;
    }
    
    // Unknown command
    await sock.sendMessage(from, { text: `❌ Unknown command: ${mainCmd}\nType .menu for help` });
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
        await sock.sendMessage(from, { text: '🔗 *Link Detected!*\nLinks are not allowed here.' });
        return true;
    }
    return false;
}

// ============ CONNECT TO WHATSAPP (WITH PAIRING CODE) ============
async function connectToWhatsApp(usePairingCode = false, phoneNumber = null) {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(SESSIONS_DIR);
        const { version } = await fetchLatestBaileysVersion();
        
        const sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: !usePairingCode,
            browser: Browsers.macOS('Desktop'),
            logger: Pino({ level: 'silent' }),
            markOnlineOnConnect: true
        });
        
        // Handle pairing code if requested
        if (usePairingCode && phoneNumber) {
            console.log(`\n🔑 Requesting pairing code for ${phoneNumber}...\n`);
            setTimeout(async () => {
                try {
                    const code = await sock.requestPairingCode(phoneNumber);
                    global.pairingCode = code;
                    console.log(`
╔═══════════════════════════════════════════╗
║     🔑 YOUR PAIRING CODE                  ║
║                                          ║
║        ${code}                             ║
║                                          ║
║  Open WhatsApp → Settings →               ║
║  Linked Devices → Link with code         ║
║  Enter this code                         ║
╚═══════════════════════════════════════════╝
`);
                } catch (error) {
                    console.log('❌ Failed to get pairing code:', error.message);
                }
            }, 3000);
        }
        
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr && !usePairingCode) {
                console.log('\n📱 QR CODE GENERATED!');
                console.log('Scan with WhatsApp → Linked Devices\n');
                qrcode.generate(qr, { small: true });
            }
            
            if (connection === 'open') {
                global.isConnected = true;
                global.currentNumber = sock.user.id.split(':')[0];
                console.log('\n✅ =====================================');
                console.log(`✅ ${BOT_NAME} CONNECTED!`);
                console.log(`✅ Number: ${global.currentNumber}`);
                console.log('✅ =====================================\n');
                console.log('📝 Bot is ready! Type .menu in WhatsApp\n');
            }
            
            if (connection === 'close') {
                global.isConnected = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                console.log(`\n❌ Disconnected: ${statusCode}`);
                
                if (statusCode !== DisconnectReason.loggedOut) {
                    console.log('🔄 Reconnecting in 10 seconds...\n');
                    setTimeout(() => connectToWhatsApp(false), 10000);
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
                               msg.message.extendedTextMessage?.text || '';
            
            if (!messageText) return;
            
            console.log(`📩 [${formatNumber(from)}]: ${messageText}`);
            
            if (messageText.startsWith(PREFIX)) {
                await handleCommand(messageText, from, sock);
            } else {
                await checkAutoReply(messageText, from, sock);
                await checkAntiLink(messageText, from, sock);
            }
        });
        
        return sock;
        
    } catch (error) {
        console.error('Connection error:', error);
        setTimeout(() => connectToWhatsApp(false), 10000);
    }
}

// ============ START BOT WITH CHOICE ============
async function start() {
    console.log(`
╔═══════════════════════════════════════════╗
║     🤖 ${BOT_NAME} WHATSAPP BOT              ║
║     Version: ${BOT_VERSION}                      ║
║     Developer: HJ-HACKER                   ║
╚═══════════════════════════════════════════╝
    `);
    
    console.log('Choose connection method:');
    console.log('┌─────────────────────────────────────┐');
    console.log('│ 1. QR Code Scan                     │');
    console.log('│ 2. Pairing Code (8-digit code)      │');
    console.log('│ 3. Use existing session             │');
    console.log('└─────────────────────────────────────┘');
    
    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    rl.question('\nEnter your choice (1/2/3): ', async (choice) => {
        if (choice === '2') {
            rl.question('Enter your WhatsApp number with country code (e.g., 923001234567): ', async (number) => {
                rl.close();
                console.log('\n🔄 Generating pairing code...\n');
                await connectToWhatsApp(true, number);
            });
        } else if (choice === '3') {
            rl.close();
            console.log('\n🔄 Loading existing session...\n');
            await connectToWhatsApp(false);
        } else {
            rl.close();
            console.log('\n🔄 QR Code mode selected. Scan the QR code with WhatsApp.\n');
            await connectToWhatsApp(false);
        }
    });
}

// Handle exit
process.on('SIGINT', async () => {
    console.log('\n\n🛑 Bot shutting down...');
    process.exit(0);
});

// Start bot
start();
