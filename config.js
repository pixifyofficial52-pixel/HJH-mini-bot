// Bot Configuration
module.exports = {
    // WhatsApp API URL
    API_BASE: 'https://whatsapp-auth-api-production.up.railway.app',
    
    // Session storage
    SESSIONS_DIR: './sessions',
    
    // Prefix for commands
    PREFIX: '.',
    
    // Auto reply rules
    autoReplyRules: [],
    
    // Anti-delete settings
    antiDelete: false,
    
    // Anti-link settings
    antiLink: false,
    antiLinkWhitelist: ['whatsapp.com', 'youtube.com', 'instagram.com'],
    
    // Auto status settings
    autoStatusView: false,
    autoStatusReact: false,
    autoStatusReactEmoji: '👍',
    
    // Online schedule (24-hour format)
    onlineSchedule: {
        enabled: false,
        start: 9,
        end: 22
    }
};
