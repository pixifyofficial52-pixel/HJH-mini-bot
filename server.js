const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { default: makeWASocket, useMultiFileAuthState, Browsers } = require('@whiskeysockets/baileys');
const P = require('pino');
const { Boom } = require('@hapi/boom');

// ✅ FIX: Explicitly require crypto
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

// Store active pairing sessions
const pairingSessions = new Map();

// ========== ROUTES ==========

// Home page
app.get('/', (req, res) => {
    res.render('login', {
        botName: process.env.BOT_NAME || 'HJ-HACKER',
        error: null,
        success: null
    });
});

// Generate REAL pairing code
app.post('/api/request-code', async (req, res) => {
    const { phone } = req.body;
    
    console.log('📱 Pairing request for:', phone);
    
    if (!phone || phone.length < 10) {
        return res.status(400).json({ 
            success: false, 
            error: 'Valid phone number required' 
        });
    }

    try {
        // Clean phone number
        const cleanPhone = phone.replace(/\D/g, '');
        
        // Create session directory
        const sessionDir = path.join(authDir, cleanPhone);
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }

        // Load auth state
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        // Create socket connection with crypto fix
        const sock = makeWASocket({
            auth: state,
            logger: P({ level: 'silent' }),
            browser: Browsers.macOS('Desktop'),
            syncFullHistory: false,
            generateHighQualityLinkPreview: false,
            shouldSyncHistoryMessage: false,
            // ✅ Add crypto to options
            crypto: crypto
        });

        // Variable to store pairing code
        let pairingCode = null;
        let codeGenerated = false;

        // Wait for pairing code
        const codePromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Connection timeout'));
            }, 30000);

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;

                if (update.pairingCode) {
                    pairingCode = update.pairingCode;
                    codeGenerated = true;
                    console.log('✅ Real Pairing Code:', pairingCode);
                    
                    // Store session
                    pairingSessions.set(cleanPhone, {
                        sock,
                        code: pairingCode,
                        time: Date.now()
                    });

                    clearTimeout(timeout);
                    resolve(pairingCode);
                }

                if (connection === 'open') {
                    console.log('✅ Bot connected for:', cleanPhone);
                    
                    // Send welcome message
                    setTimeout(async () => {
                        try {
                            await sock.sendMessage(cleanPhone + '@s.whatsapp.net', {
                                text: `┌─── 🎉 *WELCOME TO ${process.env.BOT_NAME || 'HJ-HACKER'}* ───┐\n` +
                                      `│                                          │\n` +
                                      `│  ✅ *Successfully Connected!*            │\n` +
                                      `│  📱 Use !menu for commands               │\n` +
                                      `└──────────────────────────────────────────┘`
                            });
                        } catch (e) {
                            console.error('Welcome message error:', e);
                        }
                    }, 2000);
                }

                if (connection === 'close') {
                    const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== 401;
                    console.log('Connection closed, reconnecting:', shouldReconnect);
                }
            });
        });

        // Request pairing code
        setTimeout(() => {
            try {
                sock.requestPairingCode(cleanPhone);
                console.log('📤 Pairing code requested for:', cleanPhone);
            } catch (error) {
                console.error('❌ Error requesting pairing code:', error);
            }
        }, 2000);

        // Wait for code
        const code = await Promise.race([
            codePromise,
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout generating code')), 25000)
            )
        ]);

        // Clean up old sessions
        setTimeout(() => {
            if (pairingSessions.has(cleanPhone)) {
                const session = pairingSessions.get(cleanPhone);
                if (session.sock) {
                    session.sock.end();
                }
                pairingSessions.delete(cleanPhone);
            }
        }, 300000);

        res.json({
            success: true,
            code: code,
            message: 'Real WhatsApp pairing code generated!'
        });

    } catch (error) {
        console.error('❌ Pairing error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Failed to generate code'
        });
    }
});

// Check connection status
app.get('/api/status/:phone', (req, res) => {
    const { phone } = req.params;
    const cleanPhone = phone.replace(/\D/g, '');
    const session = pairingSessions.get(cleanPhone);
    
    res.json({
        connected: session?.sock?.user ? true : false,
        status: session?.sock?.user ? 'connected' : 'waiting',
        time: session?.time || null
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        activeSessions: pairingSessions.size,
        botName: process.env.BOT_NAME || 'HJ-HACKER'
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`┌─────────────────────────────────────┐`);
    console.log(`│  🚀 HJ-HACKER BOT SERVER           │`);
    console.log(`├─────────────────────────────────────┤`);
    console.log(`│  📍 Port: ${PORT}                   │`);
    console.log(`│  🌐 URL: http://localhost:${PORT}   │`);
    console.log(`│  🔒 HTTPS: Auto on Railway         │`);
    console.log(`│  📱 Real Pairing Codes: ACTIVE     │`);
    console.log(`└─────────────────────────────────────┘`);
});
