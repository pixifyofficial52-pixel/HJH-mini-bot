const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const Pino = require('pino');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const qrcode = require('qrcode-terminal');
const config = require('./config');
const helper = require('./helper');

// Global variables
let sock = null;
let isConnected = false;
let currentNumber = null;

// Load settings
let settings = config.loadSettings();

// Set global variables
global.botName = config.BOT_NAME;
global.botVersion = config.BOT_VERSION;
global.autoReplyRules = settings.autoReplyRules || [];
global.antiDelete = settings.antiDelete || false;
global.antiLink = settings.antiLink || false;
global.autoStatusView = settings.autoStatusView || false;
global.autoStatusReact = settings.autoStatusReact || false;
global.autoStatusReactEmoji = settings.autoStatusReactEmoji || '👍';
global.saveViewOnce = settings.saveViewOnce || false;
global.antiLinkWhitelist = config.ANTI_LINK_WHITELIST;
global.deletedMessages = new Map();
global.viewOnceMedia = new Map();
global.statusSeen = new Set();

// Save settings function
function saveSettings() {
    const settingsToSave = {
        autoReplyRules: global.autoReplyRules,
        antiDelete: global.antiDelete,
        antiLink: global.antiLink,
        autoStatusView: global.autoStatusView,
        autoStatusReact: global.autoStatusReact,
        autoStatusReactEmoji: global.autoStatusReactEmoji,
        saveViewOnce: global.saveViewOnce
    };
    config.saveSettings(settingsToSave);
}

// ============ COMMAND HANDLER ============
async function handleCommand(message, from, sock) {
    const command = message.slice(1).toLowerCase().trim();
    const args = command.split(' ');
    const mainCmd = args[0];
    
    // Menu command
    if (mainCmd === 'menu' || mainCmd === 'help') {
        await sock.sendMessage(from, { text: helper.getMenu() });
        return true;
    }
    
    // Ping command
    if (mainCmd === 'ping') {
        await sock.sendMessage(from, { text: '🏓 *Pong!*\nBot is active and running.' });
        return true;
    }
    
    // Info command
    if (mainCmd === 'info') {
        await sock.sendMessage(from, { text: helper.getInfo(sock, isConnected) });
        return true;
    }
    
    // ============ AUTO REPLY COMMANDS ============
    if (mainCmd === 'addreply') {
        const parts = message.slice(1).split('|');
        if (parts.length < 2) {
            await sock.sendMessage(from, { text: '❌ *Usage:* .addreply keyword|reply' });
            return true;
        }
        
        const keyword = parts[0].replace('addreply', '').trim();
        const reply = parts[1].trim();
        
        const rule = {
            id: Date.now(),
            keyword: keyword.toLowerCase(),
            reply: reply,
            enabled: true
        };
        
        global.autoReplyRules.push(rule);
        saveSettings();
        
        await sock.sendMessage(from, { text: `✅ *Auto Reply Added!*\n\n🔑 Keyword: *${keyword}*\n💬 Reply: *${reply}*` });
        return true;
    }
    
    if (mainCmd === 'listreply') {
        if (global.autoReplyRules.length === 0) {
            await sock.sendMessage(from, { text: '📭 *No auto reply rules found.*\nUse .addreply keyword|reply to add.' });
            return true;
        }
        
        let ruleList = '📋 *Auto Reply Rules*\n━━━━━━━━━━━━━━\n';
        global.autoReplyRules.forEach((rule, index) => {
            ruleList += `\n${index + 1}. 🔑 *${rule.keyword}*\n   💬 → ${rule.reply}\n   🆔 ID: ${rule.id}\n`;
        });
        await sock.sendMessage(from, { text: ruleList });
        return true;
    }
    
    if (mainCmd === 'delreply') {
        const ruleId = parseInt(args[1]);
        if (!ruleId) {
            await sock.sendMessage(from, { text: '❌ *Usage:* .delreply rule_id' });
            return true;
        }
        
        const index = global.autoReplyRules.findIndex(r => r.id === ruleId);
        if (index !== -1) {
            const removed = global.autoReplyRules.splice(index, 1);
            saveSettings();
            await sock.sendMessage(from, { text: `✅ *Rule deleted:* ${removed[0].keyword}` });
        } else {
            await sock.sendMessage(from, { text: '❌ Rule not found. Use .listreply to see IDs.' });
        }
        return true;
    }
    
    // ============ ANTI DELETE ============
    if (mainCmd === 'antidelete') {
        const action = args[1];
        if (action === 'on') {
            global.antiDelete = true;
            saveSettings();
            await sock.sendMessage(from, { text: '✅ *Anti Delete Activated!*\nDeleted messages will be captured.' });
        } else if (action === 'off') {
            global.antiDelete = false;
            saveSettings();
            await sock.sendMessage(from, { text: '❌ *Anti Delete Deactivated*' });
        } else {
            await sock.sendMessage(from, { text: `🛡️ *Anti Delete Status:* ${global.antiDelete ? 'ON' : 'OFF'}\nUse .antidelete on/off to change.` });
        }
        return true;
    }
    
    if (mainCmd === 'deleted') {
        const sessionDeleted = global.deletedMessages.get(from) || [];
        if (sessionDeleted.length === 0) {
            await sock.sendMessage(from, { text: '📭 *No deleted messages captured yet.*' });
            return true;
        }
        
        let msg = '🗑️ *Last 10 Deleted Messages*\n━━━━━━━━━━━━━━\n';
        sessionDeleted.slice(0, 10).forEach((log, i) => {
            msg += `\n${i+1}. 📩 *From:* ${log.from}\n   💬 *Message:* ${log.message}\n   🕐 *Time:* ${new Date(log.capturedAt).toLocaleTimeString()}\n`;
        });
        await sock.sendMessage(from, { text: msg });
        return true;
    }
    
    // ============ ANTI LINK ============
    if (mainCmd === 'antilink') {
        const action = args[1];
        if (action === 'on') {
            global.antiLink = true;
            saveSettings();
            await sock.sendMessage(from, { text: '✅ *Anti Link Activated!*\nLinks will be blocked automatically.' });
        } else if (action === 'off') {
            global.antiLink = false;
            saveSettings();
            await sock.sendMessage(from, { text: '❌ *Anti Link Deactivated*' });
        } else {
            await sock.sendMessage(from, { text: `🔗 *Anti Link Status:* ${global.antiLink ? 'ON' : 'OFF'}\nUse .antilink on/off to change.` });
        }
        return true;
    }
    
    if (mainCmd === 'whitelist') {
        const action = args[1];
        const domain = args[2];
        
        if (!action || !domain) {
            await sock.sendMessage(from, { text: '❌ *Usage:* .whitelist add/remove domain.com' });
            return true;
        }
        
        if (action === 'add') {
            if (!global.antiLinkWhitelist.includes(domain)) {
                global.antiLinkWhitelist.push(domain);
                await sock.sendMessage(from, { text: `✅ Added *${domain}* to whitelist` });
            } else {
                await sock.sendMessage(from, { text: `⚠️ *${domain}* already in whitelist` });
            }
        } else if (action === 'remove') {
            const index = global.antiLinkWhitelist.indexOf(domain);
            if (index !== -1) {
                global.antiLinkWhitelist.splice(index, 1);
                await sock.sendMessage(from, { text: `✅ Removed *${domain}* from whitelist` });
            } else {
                await sock.sendMessage(from, { text: `❌ *${domain}* not found in whitelist` });
            }
        }
        return true;
    }
    
    // ============ AUTO STATUS ============
    if (mainCmd === 'autostatus') {
        const action = args[1];
        if (action === 'on') {
            global.autoStatusView = true;
            saveSettings();
            await sock.sendMessage(from, { text: '✅ *Auto Status View Activated!*\nI will view all statuses automatically.' });
        } else if (action === 'off') {
            global.autoStatusView = false;
            saveSettings();
            await sock.sendMessage(from, { text: '❌ *Auto Status View Deactivated*' });
        } else {
            await sock.sendMessage(from, { text: `👁️ *Auto Status View:* ${global.autoStatusView ? 'ON' : 'OFF'}\nUse .autostatus on/off to change.` });
        }
        return true;
    }
    
    if (mainCmd === 'statusreact') {
        const action = args[1];
        if (action === 'on') {
            global.autoStatusReact = true;
            saveSettings();
            await sock.sendMessage(from, { text: `✅ *Auto Status React Activated!*\nReaction: ${global.autoStatusReactEmoji}` });
        } else if (action === 'off') {
            global.autoStatusReact = false;
            saveSettings();
            await sock.sendMessage(from, { text: '❌ *Auto Status React Deactivated*' });
        } else {
            await sock.sendMessage(from, { text: `👍 *Auto Status React:* ${global.autoStatusReact ? 'ON' : 'OFF'}\nUse .statusreact on/off to change.` });
        }
        return true;
    }
    
    // ============ GET DP ============
    if (mainCmd === 'dp') {
        let targetNumber = args[1];
        if (!targetNumber) {
            await sock.sendMessage(from, { text: '❌ *Usage:* .dp @number\nExample: .dp 923001234567' });
            return true;
        }
        
        targetNumber = targetNumber.replace('@', '');
        
        await sock.sendMessage(from, { text: `📸 *Fetching profile picture...*\nNumber: ${targetNumber}` });
        
        try {
            const jid = targetNumber.includes('@') ? targetNumber : `${targetNumber}@s.whatsapp.net`;
            const ppUrl = await sock.profilePictureUrl(jid, 'image');
            await sock.sendMessage(from, { 
                image: { url: ppUrl },
                caption: `📸 *Profile Picture*\n\n*Number:* ${targetNumber}`
            });
        } catch (error) {
            await sock.sendMessage(from, { text: `❌ *DP not found*\nUser may have no profile picture or privacy settings.` });
        }
        return true;
    }
    
    // ============ VIEW ONCE SAVER ============
    if (mainCmd === 'saveviewonce') {
        const action = args[1];
        if (action === 'on') {
            global.saveViewOnce = true;
            saveSettings();
            await sock.sendMessage(from, { text: '✅ *View Once Saver Activated!*\nView once media will be saved automatically.' });
        } else if (action === 'off') {
            global.saveViewOnce = false;
            saveSettings();
            await sock.sendMessage(from, { text: '❌ *View Once Saver Deactivated*' });
        } else {
            await sock.sendMessage(from, { text: `📸 *View Once Saver:* ${global.saveViewOnce ? 'ON' : 'OFF'}\nUse .saveviewonce on/off to change.` });
        }
        return true;
    }
    
    // ============ ONLINE STATUS ============
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
    
    // ============ SEND MESSAGE ============
    if (mainCmd === 'send') {
        const parts = message.slice(1).split('|');
        if (parts.length < 2) {
            await sock.sendMessage(from, { text: '❌ *Usage:* .send number|message' });
            return true;
        }
        
        const targetNumber = parts[0].replace('send', '').trim();
        const messageToSend = parts[1].trim();
        const targetJid = targetNumber.includes('@') ? targetNumber : `${targetNumber}@s.whatsapp.net`;
        
        try {
            await sock.sendMessage(targetJid, { text: messageToSend });
            await sock.sendMessage(from, { text: `📤 *Message Sent!*\nTo: ${targetNumber}\nMessage: ${messageToSend}` });
        } catch (error) {
            await sock.sendMessage(from, { text: `❌ *Failed to send message*\n${error.message}` });
        }
        return true;
    }
    
    // ============ BROADCAST ============
    if (mainCmd === 'broadcast') {
        const broadcastMsg = message.slice(1).replace('broadcast', '').trim();
        if (!broadcastMsg) {
            await sock.sendMessage(from, { text: '❌ *Usage:* .broadcast message' });
            return true;
        }
        
        await sock.sendMessage(from, { text: `📢 *Broadcast Started!*\nMessage: ${broadcastMsg}\n\n*Note:* This will send to all active chats.` });
        return true;
    }
    
    // Unknown command
    await sock.sendMessage(from, { text: `❌ *Unknown Command:* ${mainCmd}\n\nType *.menu* to see all available commands.` });
    return true;
}

// ============ AUTO REPLY CHECK ============
async function checkAutoReply(message, from, sock) {
    const lowerMsg = message.toLowerCase();
    for (const rule of global.autoReplyRules) {
        if (rule.enabled && lowerMsg.includes(rule.keyword.toLowerCase())) {
            await sock.sendMessage(from, { text: rule.reply });
            return true;
        }
    }
    return false;
}

// ============ CAPTURE DELETED MESSAGE ============
function captureDeletedMessage(message, from, to) {
    if (!global.antiDelete) return;
    
    const key = to || from;
    const sessionDeleted = global.deletedMessages.get(key) || [];
    sessionDeleted.unshift({
        from: helper.formatNumber(from),
        message: message,
        capturedAt: new Date().toISOString()
    });
    
    if (sessionDeleted.length > 50) sessionDeleted.pop();
    global.deletedMessages.set(key, sessionDeleted);
    
    console.log(`🗑️ Deleted message captured from ${from}: ${message}`);
}

// ============ DOWNLOAD VIEW ONCE MEDIA ============
async function downloadViewOnceMedia(message, from, sock) {
    if (!global.saveViewOnce) return;
    
    if (message.message?.viewOnceMessageV2) {
        const viewOnceMsg = message.message.viewOnceMessageV2.message;
        let mediaUrl, caption;
        
        if (viewOnceMsg?.imageMessage) {
            const stream = await downloadContentFromMessage(viewOnceMsg.imageMessage, 'image');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            
            await sock.sendMessage(from, {
                image: buffer,
                caption: `📸 *View Once Image Saved*\n📅 ${new Date().toLocaleString()}\n👑 Saved by HJ-HACKER Bot`
            });
            console.log(`📸 View once image saved from ${from}`);
        } else if (viewOnceMsg?.videoMessage) {
            const stream = await downloadContentFromMessage(viewOnceMsg.videoMessage, 'video');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            
            await sock.sendMessage(from, {
                video: buffer,
                caption: `🎥 *View Once Video Saved*\n📅 ${new Date().toLocaleString()}\n👑 Saved by HJ-HACKER Bot`
            });
            console.log(`🎥 View once video saved from ${from}`);
        }
    }
}

// ============ AUTO VIEW STATUS ============
async function autoViewStatus(status, sock) {
    if (!global.autoStatusView) return;
    
    const statusId = status.key.id;
    if (!global.statusSeen.has(statusId)) {
        global.statusSeen.add(statusId);
        
        await sock.readMessages([status.key]);
        console.log(`👁️ Auto viewed status from ${status.key.remoteJid}`);
        
        if (global.autoStatusReact) {
            await sock.sendMessage(status.key.remoteJid, {
                react: { text: global.autoStatusReactEmoji, key: status.key }
            });
            console.log(`👍 Auto reacted with ${global.autoStatusReactEmoji}`);
        }
    }
}

// ============ CONNECT TO WHATSAPP ============
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(config.SESSIONS_DIR);
    const { version } = await fetchLatestBaileysVersion();
    
    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: Browsers.macOS('Desktop'),
        logger: Pino({ level: 'silent' }),
        syncFullHistory: false,
        markOnlineOnConnect: true
    });
    
    // Handle QR code
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('\n📱 SCAN THIS QR CODE WITH WHATSAPP:\n');
            qrcode.generate(qr, { small: true });
            console.log('\n⚡ Or use pairing code method:');
            console.log('📌 Send .paircode command in terminal after starting\n');
        }
        
        if (connection === 'open') {
            isConnected = true;
            const user = sock.user;
            currentNumber = user.id.split(':')[0];
            console.log('\n✅ Bot Connected Successfully!');
            console.log(`📱 Connected Number: ${currentNumber}`);
            console.log(`🤖 Bot Name: ${global.botName}`);
            console.log('\n📝 Commands: Type .menu in WhatsApp\n');
        }
        
        if (connection === 'close') {
            isConnected = false;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            
            console.log(`\n❌ Connection closed: ${statusCode}`);
            if (shouldReconnect) {
                console.log('🔄 Reconnecting in 5 seconds...\n');
                setTimeout(connectToWhatsApp, 5000);
            } else {
                console.log('🔒 Logged out. Please delete sessions folder and restart.\n');
            }
        }
    });
    
    // Save credentials
    sock.ev.on('creds.update', saveCreds);
    
    // Handle incoming messages
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        
        const from = msg.key.remoteJid;
        const messageText = msg.message.conversation || 
                           msg.message.extendedTextMessage?.text || 
                           msg.message.imageMessage?.caption ||
                           '';
        
        if (!messageText) return;
        
        console.log(`📩 [${helper.formatNumber(from)}]: ${messageText}`);
        
        // Check if it's a command
        if (messageText.startsWith(config.PREFIX)) {
            await handleCommand(messageText, from, sock);
        } else {
            // Check auto reply
            await checkAutoReply(messageText, from, sock);
            
            // Anti link check
            if (global.antiLink && helper.containsLink(messageText)) {
                const isWhitelisted = helper.isWhitelisted(messageText, global.antiLinkWhitelist);
                if (!isWhitelisted) {
                    await sock.sendMessage(from, { 
                        text: '🔗 *Link Detected!*\n\nLinks are not allowed in this chat. Please avoid sending links.' 
                    });
                }
            }
        }
        
        // Download view once media
        await downloadViewOnceMedia(msg, from, sock);
    });
    
    // Handle deleted messages
    sock.ev.on('messages.update', async (updates) => {
        for (const update of updates) {
            if (update.update?.message) {
                const message = update.update.message;
                const key = update.key;
                const messageText = message.conversation || message.extendedTextMessage?.text || '';
                
                if (messageText) {
                    captureDeletedMessage(messageText, key.remoteJid, key.fromMe ? key.remoteJid : null);
                }
            }
        }
    });
    
    // Handle status updates
    sock.ev.on('status.update', async (status) => {
        await autoViewStatus(status, sock);
    });
}

// ============ PAIRING CODE METHOD ============
async function pairWithCode(number) {
    const { state, saveCreds } = await useMultiFileAuthState(config.SESSIONS_DIR);
    const { version } = await fetchLatestBaileysVersion();
    
    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: Browsers.macOS('Desktop'),
        logger: Pino({ level: 'silent' })
    });
    
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('\n📱 QR Code Generated - Also scan this if pairing fails:\n');
            qrcode.generate(qr, { small: true });
        }
        
        if (connection === 'open') {
            isConnected = true;
            console.log('\n✅ Bot Connected Successfully!');
            console.log(`📱 Connected Number: ${sock.user.id.split(':')[0]}\n`);
        }
        
        if (connection === 'close') {
            isConnected = false;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                setTimeout(() => connectToWhatsApp(), 5000);
            }
        }
    });
    
    sock.ev.on('creds.update', saveCreds);
    
    // Request pairing code
    if (number) {
        const code = await sock.requestPairingCode(number);
        console.log(`\n🔑 Your Pairing Code: ${code}`);
        console.log(`📌 Open WhatsApp → Settings → Linked Devices → Link with code`);
        console.log(`📌 Enter this code: ${code}\n`);
    }
}

// ============ START BOT ============
async function start() {
    console.log(`
╔═══════════════════════════════════════════╗
║     🤖 ${global.botName} WHATSAPP BOT         ║
║     Version: ${global.botVersion}                      ║
║     Developer: HJ-HACKER                   ║
╚═══════════════════════════════════════════╝
    `);
    
    console.log('Choose connection method:');
    console.log('1. QR Code Scan (Recommended)');
    console.log('2. Pairing Code (8-digit code)');
    console.log('3. Use existing session\n');
    
    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    rl.question('Enter your choice (1/2/3): ', async (choice) => {
        if (choice === '2') {
            rl.question('Enter your WhatsApp number with country code (e.g., 923001234567): ', async (number) => {
                rl.close();
                await pairWithCode(number);
            });
        } else if (choice === '3') {
            rl.close();
            await connectToWhatsApp();
        } else {
            rl.close();
            await connectToWhatsApp();
        }
    });
}

// Handle exit
process.on('SIGINT', async () => {
    console.log('\n\n🛑 Bot shutting down...');
    if (sock) {
        await sock.logout();
    }
    process.exit(0);
});

// Start bot
start();
