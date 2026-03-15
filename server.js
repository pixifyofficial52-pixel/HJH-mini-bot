const express = require('express');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { default: makeWASocket, useMultiFileAuthState, Browsers } = require('@whiskeysockets/baileys');
const P = require('pino');
const QRCode = require('qrcode');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));

const authDir = path.join(__dirname, 'auth');
if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

const sessions = new Map();

app.get('/', (req, res) => {
    res.render('qr-login', {
        botName: process.env.BOT_NAME || 'HJ-HACKER'
    });
});

app.post('/api/start-session', async (req, res) => {
    try {
        const sessionId = Date.now().toString();
        const sessionDir = path.join(authDir, sessionId);
        
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        
        const sock = makeWASocket({
            auth: state,
            logger: P({ level: 'silent' }),
            browser: Browsers.macOS('Desktop'),
            syncFullHistory: false
        });

        sessions.set(sessionId, { sock, qr: null, connected: false });

        // Wait for QR code
        const qrPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('QR timeout'));
            }, 60000);

            sock.ev.on('connection.update', (update) => {
                if (update.qr) {
                    console.log('✅ QR generated');
                    clearTimeout(timeout);
                    resolve(update.qr);
                }
                
                if (update.connection === 'open') {
                    const session = sessions.get(sessionId);
                    if (session) {
                        session.connected = true;
                        sessions.set(sessionId, session);
                    }
                }
            });

            sock.ev.on('creds.update', saveCreds);
        });

        const qrString = await qrPromise;
        const qrImage = await QRCode.toDataURL(qrString);

        res.json({
            success: true,
            sessionId,
            qr: qrImage
        });

    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

app.get('/api/status/:sessionId', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    res.json({
        connected: session?.connected || false
    });
});

app.listen(PORT, () => {
    console.log(`✅ Server on port ${PORT}`);
});
