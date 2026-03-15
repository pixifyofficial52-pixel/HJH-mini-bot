const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { default: makeWASocket, useMultiFileAuthState, Browsers } = require('@whiskeysockets/baileys');
const P = require('pino');
const { Boom } = require('@hapi/boom');

// ✅ FIX: Set crypto globally
const crypto = require('crypto');
global.crypto = crypto;

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session
app.use(session({
    secret: process.env.SESSION_SECRET || 'hjhacker_super_secret',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 600000 }
}));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Create auth directory
const authDir = path.join(__dirname, 'auth');
if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
}

// Store active connections
const activeConnections = new Map();

// ========== ROUTES ==========

app.get('/', (req, res) => {
    res.render('login', {
        botName: process.env.BOT_NAME || 'HJ-HACKER'
    });
});

// ✅ SIMPLIFIED WORKING VERSION
app.post('/api/request-code', async (req, res) => {
    const { phone } = req.body;
    
    console.log('📱 Request for:', phone);
    
    if (!phone || phone.length < 10) {
        return res.json({ 
            success: false, 
            error: 'Valid phone number required' 
        });
    }

    try {
        const cleanPhone = phone.replace(/\D/g, '');
        
        // Create session directory
        const sessionDir = path.join(authDir, cleanPhone);
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }

        // Load auth state
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        // Create socket with simple config
        const sock = makeWASocket({
            auth: state,
            logger: P({ level: 'silent' }),
            browser: Browsers.macOS('Desktop'),
            syncFullHistory: false,
            generateHighQualityLinkPreview: false
        });

        // Store connection
        activeConnections.set(cleanPhone, {
            sock,
            time: Date.now(),
            connected: false
        });

        // Wait for pairing code
        let pairingCode = null;
        
        const codePromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout: No code received'));
            }, 45000);

            sock.ev.on('connection.update', (update) => {
                console.log('Update:', Object.keys(update));

                // Get pairing code
                if (update.pairingCode) {
                    pairingCode = update.pairingCode;
                    console.log('✅ CODE:', pairingCode);
                    clearTimeout(timeout);
                    resolve(pairingCode);
                }

                // Connection opened
                if (update.connection === 'open') {
                    console.log('✅ Connected');
                    const conn = activeConnections.get(cleanPhone);
                    if (conn) {
                        conn.connected = true;
                        activeConnections.set(cleanPhone, conn);
                    }
                }

                // Error handling
                if (update.connection === 'close') {
                    if (!pairingCode) {
                        clearTimeout(timeout);
                        reject(new Error('Connection closed'));
                    }
                }
            });

            // Save credentials
            sock.ev.on('creds.update', saveCreds);
        });

        // Request pairing code
        setTimeout(() => {
            console.log('📤 Requesting code for:', cleanPhone);
            try {
                sock.requestPairingCode(cleanPhone);
            } catch (error) {
                console.error('Request error:', error);
            }
        }, 2000);

        // Wait for code
        const realCode = await codePromise;

        // Clean up after 5 minutes
        setTimeout(() => {
            if (activeConnections.has(cleanPhone)) {
                const conn = activeConnections.get(cleanPhone);
                if (conn.sock) {
                    conn.sock.end();
                }
                activeConnections.delete(cleanPhone);
            }
        }, 300000);

        res.json({
            success: true,
            code: realCode,
            message: 'Real WhatsApp code generated!'
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.json({ 
            success: false, 
            error: error.message || 'Failed to generate code'
        });
    }
});

// Check status
app.get('/api/status/:phone', (req, res) => {
    const { phone } = req.params;
    const cleanPhone = phone.replace(/\D/g, '');
    const conn = activeConnections.get(cleanPhone);
    
    res.json({
        connected: conn?.connected || false
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server on port ${PORT}`);
});
