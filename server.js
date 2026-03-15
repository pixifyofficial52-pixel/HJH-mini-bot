const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { default: makeWASocket, useMultiFileAuthState, Browsers } = require('@whiskeysockets/baileys');
const P = require('pino');
const { Boom } = require('@hapi/boom');

// ✅ CRITICAL: Crypto fix for Railway
const crypto = require('crypto');
global.crypto = crypto;

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'hjhacker_super_secret',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 600000 }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Create auth directory
const authDir = path.join(__dirname, 'auth');
if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
}

// Store pairing codes
const pairingCodes = new Map();

// ========== ROUTES ==========

app.get('/', (req, res) => {
    res.render('login', {
        botName: process.env.BOT_NAME || 'HJ-HACKER'
    });
});

// ✅ SIMPLIFIED: Direct pairing code generation
app.post('/api/request-code', async (req, res) => {
    const { phone } = req.body;
    
    console.log('📱 Request for:', phone);
    
    if (!phone || phone.length < 10) {
        return res.json({ success: false, error: 'Invalid phone number' });
    }

    try {
        const cleanPhone = phone.replace(/\D/g, '');
        
        // Generate a random 8-digit code (for testing)
        // In production, WhatsApp will send real code
        const testCode = Math.floor(10000000 + Math.random() * 90000000).toString();
        
        // Store for status check
        pairingCodes.set(cleanPhone, {
            code: testCode,
            time: Date.now(),
            connected: false
        });

        console.log('✅ Code generated:', testCode);

        res.json({
            success: true,
            code: testCode,
            message: 'Enter this code in WhatsApp'
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.json({ success: false, error: error.message });
    }
});

// Check status
app.get('/api/status/:phone', (req, res) => {
    const { phone } = req.params;
    const cleanPhone = phone.replace(/\D/g, '');
    const data = pairingCodes.get(cleanPhone);
    
    res.json({
        connected: data?.connected || false,
        status: data?.connected ? 'connected' : 'waiting'
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${PORT}`);
});
