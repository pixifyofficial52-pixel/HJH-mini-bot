const fs = require('fs-extra');
const path = require('path');

// Bot Configuration
module.exports = {
    // Bot prefix
    PREFIX: '.',
    
    // Session directory
    SESSIONS_DIR: path.join(__dirname, 'sessions'),
    
    // Owner number (without @)
    OWNER_NUMBER: '923001234567',
    
    // Bot settings
    BOT_NAME: 'HJ-HACKER',
    BOT_VERSION: '3.0.0',
    
    // Anti-link whitelist
    ANTI_LINK_WHITELIST: ['whatsapp.com', 'youtube.com', 'instagram.com', 'facebook.com', 'tiktok.com'],
    
    // Default auto status react emoji
    DEFAULT_STATUS_REACT: '👍',
    
    // Auto reply rules (will be loaded from file)
    autoReplyRules: [],
    
    // Anti delete (store in memory)
    deletedMessages: new Map(),
    
    // View once media storage
    viewOnceMedia: new Map(),
    
    // Function to save settings
    saveSettings: function(settings) {
        const settingsPath = path.join(__dirname, 'settings.json');
        fs.writeJsonSync(settingsPath, settings, { spaces: 2 });
    },
    
    // Function to load settings
    loadSettings: function() {
        const settingsPath = path.join(__dirname, 'settings.json');
        if (fs.existsSync(settingsPath)) {
            return fs.readJsonSync(settingsPath);
        }
        return {
            autoReplyRules: [],
            antiDelete: false,
            antiLink: false,
            autoStatusView: false,
            autoStatusReact: false,
            autoStatusReactEmoji: '👍',
            saveViewOnce: false
        };
    }
};
