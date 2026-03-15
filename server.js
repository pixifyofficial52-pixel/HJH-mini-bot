const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { default: makeWASocket, useMultiFileAuthState, Browsers } = require('@whiskeysockets/baileys');
const P = require('pino');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Session
app.use(session({
    secret: process.env.SESSION_SECRET || 'hjhacker_secret',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 600000 }
}));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

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
    
    if (!phone || phone.length < 10) {
        return res.json({ 
            success: false, 
            error: 'Valid phone number required' 
        });
    }

    try {
        // Clean phone number
        const cleanPhone = phone.replace(/\D/g, '');
        
        // Create auth directory
        const authDir = path.join(__dirname, 'auth', cleanPhone);
        if (!fs.existsSync(authDir)) {
            fs.mkdirSync(authDir, { recursive: true });
        }

        // Load auth state
        const { state, saveCreds } = await useMultiFileAuthState(authDir);

        // Create socket connection
        const sock = makeWASocket({
            auth: state,
            logger: P({ level: 'silent' }),
            browser: Browsers.macOS('Desktop'),
            syncFullHistory: false,
            generateHighQualityLinkPreview: false,
            shouldSyncHistoryMessage: false
        });

        // Generate REAL pairing code
        let pairingCode = null;
        let codeGenerated = false;

        // Wait for connection and pairing code
        const connectionPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Connection timeout'));
            }, 30000);

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (connection === 'open') {
                    clearTimeout(timeout);
                    console.log(`✅ Bot connected for ${cleanPhone}`);
                    
                    // Send welcome message
                    setTimeout(async () => {
                        try {
                            await sock.sendMessage(cleanPhone + '@s.whatsapp.net', {
                                text: `┌─── 🎉 *WELCOME TO ${process.env.BOT_NAME}* ───┐\n` +
                                      `│                                          │\n` +
                                      `│  ✅ *Successfully Connected!*            │\n` +
                                      `│  📱 Use !menu for commands               │\n` +
                                      `└──────────────────────────────────────────┘`
                            });
                        } catch (e) {}
                    }, 2000);
                    
                    resolve({ success: true, code: pairingCode });
                }

                if (connection === 'connecting') {
                    console.log(`🔄 Connecting for ${cleanPhone}...`);
                }

                if (update.pairingCode) {
                    pairingCode = update.pairingCode;
                    codeGenerated = true;
                    console.log(`📱 Real Pairing Code for ${cleanPhone}: ${pairingCode}`);
                    
                    // Store session
                    pairingSessions.set(cleanPhone, {
                        sock,
                        code: pairingCode,
                        time: Date.now()
                    });

                    // Auto cleanup after 5 minutes
                    setTimeout(() => {
                        if (pairingSessions.has(cleanPhone)) {
                            const session = pairingSessions.get(cleanPhone);
                            if (session.sock) {
                                session.sock.end();
                            }
                            pairingSessions.delete(cleanPhone);
                        }
                    }, 300000);
                }
            });
        });

        // Request pairing code
        setTimeout(() => {
            sock.requestPairingCode(cleanPhone);
        }, 1000);

        const result = await connectionPromise;
        
        res.json({
            success: true,
            code: result.code,
            message: 'Real WhatsApp pairing code generated!'
        });

    } catch (error) {
        console.error('❌ Pairing error:', error);
        res.json({ 
            success: false, 
            error: 'Failed to generate code. Please try again.' 
        });
    }
});

// Check connection status
app.get('/api/status/:phone', (req, res) => {
    const { phone } = req.params;
    const session = pairingSessions.get(phone);
    
    res.json({
        connected: session?.sock?.user ? true : false,
        status: session ? 'connected' : 'disconnected'
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        activeSessions: pairingSessions.size
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
