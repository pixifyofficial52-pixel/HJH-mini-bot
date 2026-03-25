const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const API_BASE = 'https://whatsapp-auth-api-production.up.railway.app';

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// In-memory storage
const sessions = new Map();
const deletedMessages = new Map();

// ============ FRONTEND ROUTE ============
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ============ AUTH API ============
app.post('/api/pair', async (req, res) => {
  try {
    const { number } = req.body;
    const response = await fetch(`${API_BASE}/pair?number=${number}`);
    const data = await response.json();
    
    if (data.status === 'success') {
      const session = {
        id: number,
        number: number,
        code: data.code,
        pairedAt: new Date(),
        settings: {
          autoReply: [],
          antiDelete: false,
          antiLink: false,
          autoStatus: false
        }
      };
      sessions.set(number, session);
      res.json({ success: true, session, code: data.code });
    } else {
      res.json({ success: false, error: 'Pairing failed' });
    }
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/sessions', (req, res) => {
  res.json({ sessions: Array.from(sessions.values()) });
});

app.delete('/api/session/:id', (req, res) => {
  sessions.delete(req.params.id);
  res.json({ success: true });
});

// ============ AUTO REPLY API ============
app.get('/api/autoreply/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  res.json({ rules: session?.settings.autoReply || [] });
});

app.post('/api/autoreply/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (session) {
    const rule = {
      id: Date.now(),
      keyword: req.body.keyword,
      reply: req.body.reply,
      enabled: true
    };
    session.settings.autoReply.push(rule);
    res.json({ success: true, rule });
  } else {
    res.json({ success: false });
  }
});

app.delete('/api/autoreply/:sessionId/:ruleId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (session) {
    session.settings.autoReply = session.settings.autoReply.filter(
      r => r.id != req.params.ruleId
    );
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

// ============ ANTI DELETE API ============
app.post('/api/antidelete/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (session) {
    session.settings.antiDelete = req.body.enabled;
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
  if (!deletedMessages.has(sessionId)) {
    deletedMessages.set(sessionId, []);
  }
  const logs = deletedMessages.get(sessionId);
  logs.unshift({ ...message, capturedAt: new Date() });
  if (logs.length > 50) logs.pop();
  deletedMessages.set(sessionId, logs);
  res.json({ success: true });
});

// ============ ANTI LINK API ============
app.post('/api/antilink/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (session) {
    session.settings.antiLink = req.body.enabled;
    res.json({ success: true, antiLink: session.settings.antiLink });
  } else {
    res.json({ success: false });
  }
});

// ============ AUTO STATUS API ============
app.post('/api/autostatus/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (session) {
    session.settings.autoStatus = req.body.enabled;
    res.json({ success: true, autoStatus: session.settings.autoStatus });
  } else {
    res.json({ success: false });
  }
});

// ============ GET DP API ============
app.get('/api/dp/:number', async (req, res) => {
  try {
    res.json({ 
      success: true, 
      message: 'DP feature active',
      note: 'Use /dp command in WhatsApp'
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ============ VIEW ONCE SAVER API ============
app.post('/api/viewonce/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (session) {
    session.settings.saveViewOnce = req.body.enabled;
    res.json({ success: true, saveViewOnce: session.settings.saveViewOnce });
  } else {
    res.json({ success: false });
  }
});

app.listen(PORT, () => {
  console.log(`✅ HJ-HACKER Server running on port ${PORT}`);
});
