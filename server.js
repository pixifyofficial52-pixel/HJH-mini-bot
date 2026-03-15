const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { default: makeWASocket, useMultiFileAuthState, Browsers, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const P = require('pino');
const { Boom } = require('@hapi/boom');
const crypto = require('crypto');

// ✅ CRITICAL: Set crypto globally
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

// ✅ REAL PAIRING CODE GENERATION
app.post('/api/request-code', async (req, res) => {
    const { phone } = req.body;
    
    console.log('📱 REAL pairing request for:', phone);
    
    if (!phone || phone.length < 10) {
        return res.json({ 
            success: false, 
            error: 'Valid phone number required' 
        });
    }

    try {
        // Clean phone number (remove any non-digits)
        const cleanPhone = phone.replace(/\D/g, '');
        
        // Create session directory
        const sessionDir = path.join(authDir, cleanPhone);
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }

        // Get latest Baileys version
        const { version } = await fetchLatestBaileysVersion();
        console.log('📦 Baileys version:', version);

        // Load auth state
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        // Create socket connection
        const sock = makeWASocket({
            version,
            auth: state,
            logger: P({ level: 'silent' }),
            browser: Browsers.macOS('Desktop'),
            syncFullHistory: false,
            generateHighQualityLinkPreview: false,
            shouldSyncHistoryMessage: false,
            markOnlineOnConnect: false,
            printQRInTerminal: false
        });

        // Store connection
        activeConnections.set(cleanPhone, {
            sock,
            time: Date.now(),
            connected: false
        });

        // Variable for pairing code
        let pairingCode = null;
        let codeReceived = false;

        // Wait for REAL pairing code
        const codePromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (!codeReceived) {
                    reject(new Error('Timeout: No code received'));
                }
            }, 60000); // 60 seconds timeout

            // Listen for connection updates
            sock.ev.on('connection.update', (update) => {
                console.log('Connection update:', Object.keys(update));

                // ✅ THIS IS WHERE REAL PAIRING CODE COMES
                if (update.pairingCode) {
                    pairingCode = update.pairingCode;
                    codeReceived = true;
                    console.log('✅ REAL PAIRING CODE:', pairingCode);
                    
                    clearTimeout(timeout);
                    resolve(pairingCode);
                }

                // When connection opens
                if (update.connection === 'open') {
                    console.log('✅ Bot connected for:', cleanPhone);
                    const conn = activeConnections.get(cleanPhone);
                    if (conn) {
                        conn.connected = true;
                        activeConnections.set(cleanPhone, conn);
                    }

                    // Send welcome message
                    setTimeout(async () => {
                        try {
                            await sock.sendMessage(cleanPhone + '@s.whatsapp.net', {
                                text: `┌─── 🎉 *WELCOME TO HJ-HACKER BOT* ───┐\n` +
                                      `│                                      │\n` +
                                      `│  ✅ Connected Successfully!          │\n` +
                                      `│  📱 Send !menu for commands          │\n` +
                                      `└──────────────────────────────────────┘`
                            });
                        } catch (e) {
                            console.error('Welcome message error:', e);
                        }
                    }, 2000);
                }

                // Handle errors
                if (update.connection === 'close') {
                    const error = update.lastDisconnect?.error;
                    console.error('Connection closed:', error);
                    
                    if (!codeReceived) {
                        clearTimeout(timeout);
                        reject(error || new Error('Connection closed'));
                    }
                }
            });

            // Handle credentials update
            sock.ev.on('creds.update', saveCreds);
        });

        // ✅ REQUEST PAIRING CODE AFTER SOCKET IS READY
        setTimeout(() => {
            console.log('📤 Requesting REAL pairing code for:', cleanPhone);
            try {
                // Format phone number correctly (without +)
                const formattedPhone = cleanPhone.startsWith('+') ? cleanPhone : cleanPhone;
                sock.requestPairingCode(formattedPhone);
                console.log('📤 Pairing code requested');
            } catch (error) {
                console.error('❌ Error requesting code:', error);
            }
        }, 3000); // Wait 3 seconds for socket to initialize

        // Wait for the code
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

        // Send the REAL code back
        res.json({
            success: true,
            code: realCode,
            message: 'Real WhatsApp pairing code generated!'
        });

    } catch (error) {
        console.error('❌ REAL CODE ERROR:', error);
        res.json({ 
            success: false, 
            error: error.message || 'Failed to generate real code'
        });
    }
});

// Check connection status
app.get('/api/status/:phone', (req, res) => {
    const { phone } = req.params;
    const cleanPhone = phone.replace(/\D/g, '');
    const conn = activeConnections.get(cleanPhone);
    
    res.json({
        connected: conn?.connected || false,
        status: conn?.connected ? 'connected' : 'waiting'
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        activeConnections: activeConnections.size
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`┌─────────────────────────────────────┐`);
    console.log(`│  🚀 HJ-HACKER BOT SERVER           │`);
    console.log(`├─────────────────────────────────────┤`);
    console.log(`│  📍 Port: ${PORT}                   │`);
    console.log(`│  🔐 REAL PAIRING CODES: ACTIVE     │`);
    console.log(`└─────────────────────────────────────┘`);
});
