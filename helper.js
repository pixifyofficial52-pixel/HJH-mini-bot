const moment = require('moment');

// Format timestamp
function formatTime(timestamp) {
    return moment(timestamp).format('DD/MM/YYYY HH:mm:ss');
}

// Format number
function formatNumber(number) {
    return number.replace('@s.whatsapp.net', '').replace('@c.us', '');
}

// Check if message contains link
function containsLink(text) {
    if (!text) return false;
    const urlRegex = /(https?:\/\/[^\s]+)/gi;
    return urlRegex.test(text);
}

// Check if link is whitelisted
function isWhitelisted(text, whitelist) {
    if (!text) return false;
    for (const domain of whitelist) {
        if (text.toLowerCase().includes(domain.toLowerCase())) {
            return true;
        }
    }
    return false;
}

// Create menu
function getMenu() {
    return `
╔════════════════════════════════════════╗
║     🤖 *${global.botName || 'HJ-HACKER'} BOT MENU*      ║
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
║ 👁️ *Status Auto View*                  ║
║  .autostatus on/off                    ║
║  .statusreact on/off                   ║
║                                        ║
║ 📸 *Media Tools*                       ║
║  .dp @number - Get profile pic         ║
║  .saveviewonce on/off                  ║
║                                        ║
║ 🌐 *Online Status*                     ║
║  .online on/off - Toggle online        ║
║  .schedule start end - Set hours       ║
║                                        ║
║ 💬 *Messages*                          ║
║  .send number|message - Send msg       ║
║  .broadcast msg - Broadcast            ║
╠════════════════════════════════════════╣
║ 💡 *Example:* .addreply hello|Hi there!║
╚════════════════════════════════════════╝
    `;
}

// Get info message
function getInfo(sock, status) {
    return `
📱 *Bot Information*
━━━━━━━━━━━━━━━━━━━━━━
🤖 *Name:* ${global.botName || 'HJ-HACKER'}
📌 *Version:* ${global.botVersion || '3.0.0'}
🟢 *Status:* ${status ? 'Connected ✅' : 'Disconnected ❌'}
👑 *Developer:* HJ-HACKER
📅 *Started:* ${new Date().toLocaleString()}
━━━━━━━━━━━━━━━━━━━━━━
🔧 *Features Status:*
${global.antiDelete ? '✅ Anti Delete' : '❌ Anti Delete'}
${global.antiLink ? '✅ Anti Link' : '❌ Anti Link'}
${global.autoStatusView ? '✅ Auto Status View' : '❌ Auto Status View'}
${global.autoStatusReact ? '✅ Auto Status React' : '❌ Auto Status React'}
${global.saveViewOnce ? '✅ View Once Saver' : '❌ View Once Saver'}
━━━━━━━━━━━━━━━━━━━━━━
📊 *Stats:*
📝 Auto Replies: ${global.autoReplyRules?.length || 0}
🗑️ Deleted Captured: ${global.deletedMessages?.size || 0}
👁️ Status Viewed: ${global.statusSeen?.size || 0}
    `;
}

module.exports = {
    formatTime,
    formatNumber,
    containsLink,
    isWhitelisted,
    getMenu,
    getInfo
};
