const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const API_BASE = 'https://whatsapp-auth-api-production.up.railway.app';

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Store active sessions (in-memory for Vercel)
const sessions = new Map();

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Generate pairing code
app.post('/api/pair', async (req, res) => {
    try {
        const { number, server } = req.body;
        
        if (!number || number.length < 10) {
            return res.json({ 
                success: false, 
                error: 'Please enter valid number with country code' 
            });
        }
        
        console.log(`📱 Server ${server} - Pairing request: ${number}`);
        
        const response = await fetch(`${API_BASE}/pair?number=${number}`);
        const data = await response.json();
        
        if (data.status === 'success') {
            // Store session
            sessions.set(number, {
                number: number,
                code: data.code,
                server: server,
                timestamp: Date.now()
            });
            
            res.json({ 
                success: true, 
                code: data.code,
                message: '✅ Pairing code generated successfully!'
            });
        } else {
            res.json({ 
                success: false, 
                error: 'Failed to generate code. Try again.' 
            });
        }
    } catch (error) {
        console.error('Error:', error);
        res.json({ 
            success: false, 
            error: 'Server error. Please try again.' 
        });
    }
});

// Get server stats
app.get('/api/stats', (req, res) => {
    const activeSessions = Array.from(sessions.values()).filter(
        s => Date.now() - s.timestamp < 3600000
    ).length;
    
    res.json({
        totalSessions: sessions.size,
        activeSessions: activeSessions,
        limit: 50
    });
});

app.listen(PORT, () => {
    console.log(`✅ HJ-HACKER Pairing Server running on port ${PORT}`);
});
