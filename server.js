const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const API_BASE = 'https://whatsapp-auth-api-production.up.railway.app';

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// File paths for persistence
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');
const DELETED_FILE = path.join(__dirname, 'deleted.json');
const RULES_FILE = path.join(__dirname, 'rules.json');

// Load saved data
let sessions = new Map();
let deletedMessages = new Map();
let autoRules = new Map();

function loadData() {
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            const saved = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
            sessions = new Map(Object.entries(saved));
            console.log(`✅ Loaded ${sessions.size} sessions`);
        }
        if (fs.existsSync(DELETED_FILE)) {
            const saved = JSON.parse(fs.readFileSync(DELETED_FILE, 'utf8'));
            deletedMessages = new Map(Object.entries(saved));
        }
        if (fs.existsSync(RULES_FILE)) {
            const saved = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));
            autoRules = new Map(Object.entries(saved));
        }
    } catch (e) { console.error('Load error:', e); }
}

function saveSessions() {
    const obj = Object.fromEntries(sessions);
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2));
}

function saveDeleted() {
    const obj = Object.fromEntries(deletedMessages);
    fs.writeFileSync(DELETED_FILE, JSON.stringify(obj, null, 2));
}

function saveRules() {
    const obj = Object.fromEntries(autoRules);
    fs.writeFileSync(RULES_FILE, JSON.stringify(obj, null, 2));
}

loadData();

// ============ FRONTEND ============
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ============ PAIR API (Improved) ============
app.post('/api/pair', async (req, res) => {
    try {
        const { number } = req.body;
        
        if (!number || number.length < 10) {
            return res.json({ success: false, error: 'Valid number required (e.g., 923001234567)' });
        }
        
        console.log(`📱 Pairing request for: ${number}`);
        
        const response = await fetch(`${API_BASE}/pair?number=${number}`);
        const data = await response.json();
        
        if (data.status === 'success') {
            const sessionId = number;
            const session = {
                id: sessionId,
                number: number,
                code: data.code,
                pairedAt: new Date().toISOString(),
                status: 'pending',
                settings: {
                    antiDelete: false,
                    antiLink: false,
                    autoStatus: false,
                    saveViewOnce: false
                }
            };
            
            sessions.set(sessionId, session);
            saveSessions();
            
            console.log(`✅ Session created for ${number} with code: ${data.code}`);
            
            res.json({ 
                success: true, 
                session, 
                code: data.code,
                instructions: "Open WhatsApp → Settings → Linked Devices → Link with code → Enter this code"
            });
        } else {
            res.json({ success: false, error: 'Pairing failed. Try again.' });
        }
    } catch (error) {
        console.error('Pair error:', error);
        res.json({ success: false, error: error.message });
    }
});

// Confirm pairing (after user enters code)
app.post('/api/confirm/:sessionId', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (session) {
        session.status = 'active';
        session.pairedAt = new Date().toISOString();
        sessions.set(req.params.sessionId, session);
        saveSessions();
        console.log(`✅ Session ${req.params.sessionId} is now ACTIVE`);
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

// Get all sessions
app.get('/api/sessions', (req, res) => {
    const sessionList = Array.from(sessions.values()).map(s => ({
        ...s,
        settings: s.settings || { antiDelete: false, antiLink: false, autoStatus: false, saveViewOnce: false }
    }));
    res.json({ sessions: sessionList });
});

// Delete session
app.delete('/api/session/:id', (req, res) => {
    sessions.delete(req.params.id);
    deletedMessages.delete(req.params.id);
    autoRules.delete(req.params.id);
    saveSessions();
    saveDeleted();
    saveRules();
    res.json({ success: true });
});

// ============ AUTO REPLY ============
app.get('/api/autoreply/:sessionId', (req, res) => {
    const rules = autoRules.get(req.params.sessionId) || [];
    res.json({ rules });
});

app.post('/api/autoreply/:sessionId', (req, res) => {
    const { keyword, reply } = req.body;
    const rules = autoRules.get(req.params.sessionId) || [];
    const newRule = { id: Date.now(), keyword, reply, enabled: true };
    rules.push(newRule);
    autoRules.set(req.params.sessionId, rules);
    saveRules();
    res.json({ success: true, rule: newRule });
});

app.delete('/api/autoreply/:sessionId/:ruleId', (req, res) => {
    const rules = autoRules.get(req.params.sessionId) || [];
    const filtered = rules.filter(r => r.id != req.params.ruleId);
    autoRules.set(req.params.sessionId, filtered);
    saveRules();
    res.json({ success: true });
});

// ============ ANTI DELETE ============
app.post('/api/antidelete/:sessionId', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (session) {
        session.settings.antiDelete = req.body.enabled;
        sessions.set(req.params.sessionId, session);
        saveSessions();
        res.json({ success: true, antiDelete: session.settings.antiDelete });
    } else {
        res.json({ success: false });
    }
});

app.get('/api/antidelete/logs/:sessionId', (req, res) => {
    const logs = deletedMessages.get(req.params.sessionId) || [];
    res.json({ logs });
});

app.post('/api/antidelete/capture', (req, res) => {
    const { sessionId, message } = req.body;
    const logs = deletedMessages.get(sessionId) || [];
    logs.unshift({ ...message, capturedAt: new Date().toISOString() });
    if (logs.length > 50) logs.pop();
    deletedMessages.set(sessionId, logs);
    saveDeleted();
    res.json({ success: true });
});

// ============ ANTI LINK ============
app.post('/api/antilink/:sessionId', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (session) {
        session.settings.antiLink = req.body.enabled;
        sessions.set(req.params.sessionId, session);
        saveSessions();
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

// ============ AUTO STATUS ============
app.post('/api/autostatus/:sessionId', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (session) {
        session.settings.autoStatus = req.body.enabled;
        sessions.set(req.params.sessionId, session);
        saveSessions();
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

// ============ VIEW ONCE SAVER ============
app.post('/api/viewonce/:sessionId', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (session) {
        session.settings.saveViewOnce = req.body.enabled;
        sessions.set(req.params.sessionId, session);
        saveSessions();
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

// ============ GET DP ============
app.get('/api/dp/:number', async (req, res) => {
    try {
        res.json({ 
            success: true, 
            message: 'DP feature - Use /dp command in WhatsApp after pairing',
            note: 'Make sure session is active'
        });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`✅ HJ-HACKER Server running on port ${PORT}`);
    console.log(`📁 Sessions saved to: ${SESSIONS_FILE}`);
});
