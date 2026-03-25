const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');

// Bot Configuration
const config = {
    API_BASE: 'https://whatsapp-auth-api-production.up.railway.app',
    PREFIX: '.',
    autoReplyRules: [],
    antiDelete: false,
    antiLink: false,
    antiLinkWhitelist: ['whatsapp.com', 'youtube.com', 'instagram.com'],
    autoStatusView: false,
    autoStatusReact: false,
    autoStatusReactEmoji: '👍'
};

// Store sessions and data
let sessions = new Map();
let deletedMessages = new Map();
let statusSeen = new Set();

// ============ MAIN BOT CLASS ============
class WhatsAppBot {
    constructor() {
        this.number = null;
        this.sessionId = null;
        this.isConnected = false;
        this.pairCode = null;
    }
    
    // Pair with WhatsApp
    async pairNumber(number) {
        try {
            console.log(`📱 Pairing number: ${number}`);
            
            const response = await fetch(`${config.API_BASE}/pair?number=${number}`);
            const data = await response.json();
            
            if (data.status === 'success') {
                this.number = number;
                this.sessionId = number;
                this.pairCode = data.code;
                this.isConnected = true;
                
                // Save session
                sessions.set(number, {
                    number: number,
                    code: data.code,
                    connectedAt: new Date(),
                    settings: {
                        autoReply: [],
                        antiDelete: false,
                        antiLink: false,
                        autoStatusView: false,
                        autoStatusReact: false
                    }
                });
                
                console.log(`✅ Bot connected to: ${number}`);
                console.log(`📌 Pairing Code: ${data.code}`);
                console.log(`📌 Open WhatsApp → Settings → Linked Devices → Link with code`);
                console.log(`📌 Enter this code: ${data.code}`);
                
                return { success: true, code: data.code };
            } else {
                return { success: false, error: 'Pairing failed' };
            }
        } catch (error) {
            console.error('Pairing error:', error);
            return { success: false, error: error.message };
        }
    }
    
    // Handle incoming messages
    async handleMessage(message, from) {
        console.log(`📩 Message from ${from}: ${message}`);
        
        // Check if message is a command
        if (message.startsWith(config.PREFIX)) {
            return this.handleCommand(message, from);
        }
        
        // Auto reply
        if (config.autoReplyRules.length > 0) {
            const autoReply = await this.checkAutoReply(message);
            if (autoReply) {
                await this.sendMessage(from, autoReply);
                return;
            }
        }
        
        // Anti link check
        if (config.antiLink && this.containsLink(message)) {
            const isWhitelisted = this.checkWhitelist(message);
            if (!isWhitelisted) {
                await this.sendMessage(from, '🔗 *Link Detected!*\n\nLinks are not allowed in this chat. Please avoid sending links.');
                return;
            }
        }
    }
    
    // Handle commands
    async handleCommand(cmd, from) {
        const command = cmd.slice(1).toLowerCase().trim();
        const args = command.split(' ');
        const mainCmd = args[0];
        
        // ============ MAIN MENU ============
        if (mainCmd === 'menu' || mainCmd === 'help') {
            const menu = `
╔══════════════════════════════════╗
║     🤖 *HJ-HACKER BOT MENU*      ║
╠══════════════════════════════════╣
║ 📌 *General Commands*            ║
║  .menu / .help - Show this menu  ║
║  .ping - Check bot status        ║
║  .info - Bot information         ║
║                                  ║
║ 🤖 *Auto Reply*                  ║
║  .addreply keyword|reply         ║
║  .listreply - Show all rules     ║
║  .delreply id - Delete rule      ║
║                                  ║
║ 🛡️ *Anti Delete*                 ║
║  .antidelete on/off              ║
║  .deleted - Show deleted msgs    ║
║                                  ║
║ 🔗 *Anti Link*                   ║
║  .antilink on/off                ║
║  .whitelist add/remove domain    ║
║                                  ║
║ 👁️ *Status Auto View*            ║
║  .autostatus on/off              ║
║  .statusreact on/off             ║
║                                  ║
║ 📸 *Media Tools*                 ║
║  .dp @number - Get profile pic   ║
║  .saveviewonce on/off            ║
║                                  ║
║ 🌐 *Online Status*               ║
║  .online on/off - Toggle online  ║
║  .schedule start end - Set hours ║
║                                  ║
║ 💬 *Messages*                    ║
║  .send number|message - Send msg ║
║  .broadcast msg - Broadcast      ║
╚══════════════════════════════════╝
            `;
            await this.sendMessage(from, menu);
            return;
        }
        
        // ============ PING ============
        if (mainCmd === 'ping') {
            await this.sendMessage(from, '🏓 *Pong!*\nBot is active and running.');
            return;
        }
        
        // ============ INFO ============
        if (mainCmd === 'info') {
            const session = sessions.get(this.number);
            const info = `
📱 *Bot Information*
━━━━━━━━━━━━━━━━━━
📌 *Number:* ${this.number}
🟢 *Status:* ${this.isConnected ? 'Connected' : 'Disconnected'}
🤖 *Version:* 2.0.0
👑 *Developer:* HJ-HACKER
📅 *Started:* ${new Date().toLocaleString()}
━━━━━━━━━━━━━━━━━━
🔧 *Features Active:*
${config.antiDelete ? '✅ Anti Delete' : '❌ Anti Delete'}
${config.antiLink ? '✅ Anti Link' : '❌ Anti Link'}
${config.autoStatusView ? '✅ Auto Status View' : '❌ Auto Status View'}
${config.autoStatusReact ? '✅ Auto Status React' : '❌ Auto Status React'}
━━━━━━━━━━━━━━━━━━
            `;
            await this.sendMessage(from, info);
            return;
        }
        
        // ============ AUTO REPLY COMMANDS ============
        if (mainCmd === 'addreply') {
            const parts = cmd.slice(1).split('|');
            if (parts.length < 2) {
                await this.sendMessage(from, '❌ *Usage:* .addreply keyword|reply');
                return;
            }
            
            const keyword = parts[0].replace('addreply', '').trim();
            const reply = parts[1].trim();
            
            const rule = {
                id: Date.now(),
                keyword: keyword.toLowerCase(),
                reply: reply,
                enabled: true
            };
            
            config.autoReplyRules.push(rule);
            await this.sendMessage(from, `✅ *Auto Reply Added!*\n\n🔑 Keyword: *${keyword}*\n💬 Reply: *${reply}*`);
            return;
        }
        
        if (mainCmd === 'listreply') {
            if (config.autoReplyRules.length === 0) {
                await this.sendMessage(from, '📭 *No auto reply rules found.*\nUse .addreply keyword|reply to add.');
                return;
            }
            
            let ruleList = '📋 *Auto Reply Rules*\n━━━━━━━━━━━━━━\n';
            config.autoReplyRules.forEach((rule, index) => {
                ruleList += `\n${index + 1}. 🔑 *${rule.keyword}*\n   💬 → ${rule.reply}\n   🆔 ID: ${rule.id}\n`;
            });
            await this.sendMessage(from, ruleList);
            return;
        }
        
        if (mainCmd === 'delreply') {
            const ruleId = parseInt(args[1]);
            if (!ruleId) {
                await this.sendMessage(from, '❌ *Usage:* .delreply rule_id');
                return;
            }
            
            const index = config.autoReplyRules.findIndex(r => r.id === ruleId);
            if (index !== -1) {
                const removed = config.autoReplyRules.splice(index, 1);
                await this.sendMessage(from, `✅ *Rule deleted:* ${removed[0].keyword}`);
            } else {
                await this.sendMessage(from, '❌ Rule not found. Use .listreply to see IDs.');
            }
            return;
        }
        
        // ============ ANTI DELETE ============
        if (mainCmd === 'antidelete') {
            const action = args[1];
            if (action === 'on') {
                config.antiDelete = true;
                await this.sendMessage(from, '✅ *Anti Delete Activated!*\nDeleted messages will be captured.');
            } else if (action === 'off') {
                config.antiDelete = false;
                await this.sendMessage(from, '❌ *Anti Delete Deactivated*');
            } else {
                await this.sendMessage(from, `🛡️ *Anti Delete Status:* ${config.antiDelete ? 'ON' : 'OFF'}\nUse .antidelete on/off to change.`);
            }
            return;
        }
        
        if (mainCmd === 'deleted') {
            const sessionDeleted = deletedMessages.get(this.number) || [];
            if (sessionDeleted.length === 0) {
                await this.sendMessage(from, '📭 *No deleted messages captured yet.*');
                return;
            }
            
            let msg = '🗑️ *Last 10 Deleted Messages*\n━━━━━━━━━━━━━━\n';
            sessionDeleted.slice(0, 10).forEach((log, i) => {
                msg += `\n${i+1}. 📩 *From:* ${log.from}\n   💬 *Message:* ${log.message}\n   🕐 *Time:* ${new Date(log.capturedAt).toLocaleTimeString()}\n`;
            });
            await this.sendMessage(from, msg);
            return;
        }
        
        // ============ ANTI LINK ============
        if (mainCmd === 'antilink') {
            const action = args[1];
            if (action === 'on') {
                config.antiLink = true;
                await this.sendMessage(from, '✅ *Anti Link Activated!*\nLinks will be blocked automatically.');
            } else if (action === 'off') {
                config.antiLink = false;
                await this.sendMessage(from, '❌ *Anti Link Deactivated*');
            } else {
                await this.sendMessage(from, `🔗 *Anti Link Status:* ${config.antiLink ? 'ON' : 'OFF'}\nUse .antilink on/off to change.`);
            }
            return;
        }
        
        if (mainCmd === 'whitelist') {
            const action = args[1];
            const domain = args[2];
            
            if (!action || !domain) {
                await this.sendMessage(from, '❌ *Usage:* .whitelist add/remove domain.com');
                return;
            }
            
            if (action === 'add') {
                if (!config.antiLinkWhitelist.includes(domain)) {
                    config.antiLinkWhitelist.push(domain);
                    await this.sendMessage(from, `✅ Added *${domain}* to whitelist`);
                } else {
                    await this.sendMessage(from, `⚠️ *${domain}* already in whitelist`);
                }
            } else if (action === 'remove') {
                const index = config.antiLinkWhitelist.indexOf(domain);
                if (index !== -1) {
                    config.antiLinkWhitelist.splice(index, 1);
                    await this.sendMessage(from, `✅ Removed *${domain}* from whitelist`);
                } else {
                    await this.sendMessage(from, `❌ *${domain}* not found in whitelist`);
                }
            }
            return;
        }
        
        // ============ AUTO STATUS ============
        if (mainCmd === 'autostatus') {
            const action = args[1];
            if (action === 'on') {
                config.autoStatusView = true;
                await this.sendMessage(from, '✅ *Auto Status View Activated!*\nI will view all statuses automatically.');
            } else if (action === 'off') {
                config.autoStatusView = false;
                await this.sendMessage(from, '❌ *Auto Status View Deactivated*');
            } else {
                await this.sendMessage(from, `👁️ *Auto Status View:* ${config.autoStatusView ? 'ON' : 'OFF'}\nUse .autostatus on/off to change.`);
            }
            return;
        }
        
        if (mainCmd === 'statusreact') {
            const action = args[1];
            if (action === 'on') {
                config.autoStatusReact = true;
                await this.sendMessage(from, `✅ *Auto Status React Activated!*\nReaction: ${config.autoStatusReactEmoji}`);
            } else if (action === 'off') {
                config.autoStatusReact = false;
                await this.sendMessage(from, '❌ *Auto Status React Deactivated*');
            } else {
                await this.sendMessage(from, `👍 *Auto Status React:* ${config.autoStatusReact ? 'ON' : 'OFF'}\nUse .statusreact on/off to change.`);
            }
            return;
        }
        
        // ============ GET DP ============
        if (mainCmd === 'dp') {
            let targetNumber = args[1];
            if (!targetNumber) {
                await this.sendMessage(from, '❌ *Usage:* .dp @number\nExample: .dp 923001234567');
                return;
            }
            
            // Remove @ if present
            targetNumber = targetNumber.replace('@', '');
            
            await this.sendMessage(from, `📸 *Fetching profile picture...*\nNumber: ${targetNumber}`);
            
            try {
                const response = await fetch(`${config.API_BASE}/dp?number=${targetNumber}`);
                const data = await response.json();
                
                if (data.success && data.url) {
                    await this.sendMessage(from, `📸 *Profile Picture*\n\n*Number:* ${targetNumber}\n*URL:* ${data.url}`);
                } else {
                    await this.sendMessage(from, `❌ *DP not found*\nUser may have no profile picture or privacy settings.`);
                }
            } catch (error) {
                await this.sendMessage(from, `❌ *Error fetching DP*\n${error.message}`);
            }
            return;
        }
        
        // ============ VIEW ONCE SAVER ============
        if (mainCmd === 'saveviewonce') {
            const action = args[1];
            if (action === 'on') {
                config.saveViewOnce = true;
                await this.sendMessage(from, '✅ *View Once Saver Activated!*\nView once media will be saved automatically.');
            } else if (action === 'off') {
                config.saveViewOnce = false;
                await this.sendMessage(from, '❌ *View Once Saver Deactivated*');
            } else {
                await this.sendMessage(from, `📸 *View Once Saver:* ${config.saveViewOnce ? 'ON' : 'OFF'}\nUse .saveviewonce on/off to change.`);
            }
            return;
        }
        
        // ============ ONLINE STATUS ============
        if (mainCmd === 'online') {
            const action = args[1];
            if (action === 'on') {
                // Set online presence
                await this.sendMessage(from, '✅ *Online Mode Activated!*\nYou appear online now.');
            } else if (action === 'off') {
                // Set offline presence
                await this.sendMessage(from, '❌ *Offline Mode Activated!*\nYou appear offline now.');
            } else {
                await this.sendMessage(from, '🌐 *Online Status*\nUse .online on/off to change your presence.');
            }
            return;
        }
        
        if (mainCmd === 'schedule') {
            const start = parseInt(args[1]);
            const end = parseInt(args[2]);
            
            if (isNaN(start) || isNaN(end)) {
                await this.sendMessage(from, '❌ *Usage:* .schedule start end\nExample: .schedule 9 22 (24-hour format)');
                return;
            }
            
            config.onlineSchedule = { enabled: true, start, end };
            await this.sendMessage(from, `✅ *Online Schedule Set!*\nOnline from *${start}:00* to *${end}:00* daily.`);
            return;
        }
        
        // ============ SEND MESSAGE ============
        if (mainCmd === 'send') {
            const parts = cmd.slice(1).split('|');
            if (parts.length < 2) {
                await this.sendMessage(from, '❌ *Usage:* .send number|message');
                return;
            }
            
            const targetNumber = parts[0].replace('send', '').trim();
            const messageToSend = parts[1].trim();
            
            await this.sendMessage(from, `📤 *Message Sent!*\nTo: ${targetNumber}\nMessage: ${messageToSend}`);
            return;
        }
        
        // ============ BROADCAST ============
        if (mainCmd === 'broadcast') {
            const broadcastMsg = cmd.slice(1).replace('broadcast', '').trim();
            if (!broadcastMsg) {
                await this.sendMessage(from, '❌ *Usage:* .broadcast message');
                return;
            }
            
            await this.sendMessage(from, `📢 *Broadcast Started!*\nMessage: ${broadcastMsg}\n\n*Note:* This will send to all active chats.`);
            return;
        }
        
        // Unknown command
        await this.sendMessage(from, `❌ *Unknown Command:* ${mainCmd}\n\nType *.menu* to see all available commands.`);
    }
    
    // Check auto reply
    async checkAutoReply(message) {
        const lowerMsg = message.toLowerCase();
        for (const rule of config.autoReplyRules) {
            if (rule.enabled && lowerMsg.includes(rule.keyword.toLowerCase())) {
                return rule.reply;
            }
        }
        return null;
    }
    
    // Check if message contains link
    containsLink(message) {
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        return urlRegex.test(message);
    }
    
    // Check whitelist
    checkWhitelist(message) {
        for (const domain of config.antiLinkWhitelist) {
            if (message.includes(domain)) {
                return true;
            }
        }
        return false;
    }
    
    // Capture deleted message
    captureDeleted(message, from) {
        if (!config.antiDelete) return;
        
        const sessionDeleted = deletedMessages.get(this.number) || [];
        sessionDeleted.unshift({
            from: from,
            message: message,
            capturedAt: new Date().toISOString()
        });
        
        // Keep only last 50
        if (sessionDeleted.length > 50) sessionDeleted.pop();
        deletedMessages.set(this.number, sessionDeleted);
        
        console.log(`🗑️ Deleted message captured from ${from}: ${message}`);
    }
    
    // Send message (simulated)
    async sendMessage(to, message) {
        console.log(`💬 [SENT to ${to}]: ${message}`);
        // In real implementation, this would call WhatsApp API
        return true;
    }
    
    // Auto view status
    async autoViewStatus(statusId, from) {
        if (!config.autoStatusView) return;
        
        if (!statusSeen.has(statusId)) {
            statusSeen.add(statusId);
            console.log(`👁️ Viewed status from ${from}`);
            
            if (config.autoStatusReact) {
                console.log(`👍 Reacted with ${config.autoStatusReactEmoji} on status from ${from}`);
            }
        }
    }
}

// ============ START BOT ============
async function startBot() {
    const bot = new WhatsAppBot();
    
    // Get number from command line or use default
    const number = process.argv[2] || '923001234567';
    
    console.log(`
╔═══════════════════════════════════════╗
║     🤖 HJ-HACKER WhatsApp Bot         ║
║     Version: 2.0.0                    ║
║     Developer: HJ-HACKER              ║
╚═══════════════════════════════════════╝
    `);
    
    console.log(`🔧 Initializing bot for number: ${number}`);
    
    const result = await bot.pairNumber(number);
    
    if (result.success) {
        console.log(`
✅ Bot Started Successfully!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📱 Number: ${number}
🔑 Pairing Code: ${result.code}
💡 Open WhatsApp → Settings → Linked Devices
📌 Enter the code above to connect
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🤖 Bot is now running...
📝 Type .menu in WhatsApp to see all commands

⚠️  Note: This is a simulated bot.
   For full WhatsApp integration, you need
   to use the actual WhatsApp Web API.
        `);
    } else {
        console.log(`❌ Failed to start bot: ${result.error}`);
    }
    
    // Keep bot running
    setInterval(() => {
        console.log(`🟢 Bot active on ${number} - ${new Date().toLocaleTimeString()}`);
    }, 60000);
}

// Start the bot
startBot();
