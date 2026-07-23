const express = require('express');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== إعدادات GitHub من متغيرات البيئة =====
// ❌ لا تضع التوكن هنا
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPO || 'de7ta/api';
const FILE_PATH = 'users.json';
const API_URL = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-de7ta-2026';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

async function readUsers() {
    try {
        const response = await axios.get(API_URL, {
            headers: {
                Authorization: `token ${GITHUB_TOKEN}`,
                Accept: 'application/vnd.github.v3+json'
            }
        });
        const content = Buffer.from(response.data.content, 'base64').toString('utf8');
        return { users: JSON.parse(content), sha: response.data.sha };
    } catch (error) {
        if (error.response?.status === 404) {
            await createEmptyUsersFile();
            return { users: [], sha: null };
        }
        throw error;
    }
}

async function createEmptyUsersFile() {
    try {
        await axios.put(API_URL, {
            message: 'Create users.json',
            content: Buffer.from(JSON.stringify([], null, 2)).toString('base64')
        }, {
            headers: {
                Authorization: `token ${GITHUB_TOKEN}`,
                Accept: 'application/vnd.github.v3+json'
            }
        });
        console.log('✅ users.json created');
    } catch (error) {
        console.error('Error creating users file:', error.message);
    }
}

async function writeUsers(users, sha) {
    try {
        const content = JSON.stringify(users, null, 2);
        const base64Content = Buffer.from(content, 'utf8').toString('base64');
        await axios.put(API_URL, {
            message: 'Update users.json',
            content: base64Content,
            sha: sha
        }, {
            headers: {
                Authorization: `token ${GITHUB_TOKEN}`,
                Accept: 'application/vnd.github.v3+json'
            }
        });
    } catch (error) {
        console.error('Error writing users:', error.response?.data || error.message);
        throw error;
    }
}

app.get('/help', (req, res) => {
    res.json({
        status: 'OK',
        routes: {
            signup: '/signup/:username/:email/:password or POST /signup (JSON)',
            login: '/login/:username/:password or POST /login (JSON)',
            verify: '/verify/:token or POST /verify (JSON)',
            help: '/help',
            health: '/health'
        },
        examples: {
            signup: '/signup/ahmed/ahmed@gmail.com/123456',
            login: '/login/ahmed/123456',
            verify: '/verify/TOKEN_HERE'
        }
    });
});

app.get('/signup/:username/:email/:password', async (req, res) => {
    const { username, email, password } = req.params;
    await handleSignup(username, email, password, res);
});

app.post('/signup', async (req, res) => {
    const { username, email, password } = req.body;
    await handleSignup(username, email, password, res);
});

async function handleSignup(username, email, password, res) {
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Username, email, and password required' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (!email.includes('@') || !email.includes('.')) {
        return res.status(400).json({ error: 'Invalid email format' });
    }
    try {
        const { users, sha } = await readUsers();
        if (users.find(u => u.username === username)) {
            return res.status(409).json({ error: 'Username already exists' });
        }
        if (users.find(u => u.email === email)) {
            return res.status(409).json({ error: 'Email already registered' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        users.push({ username, email, password: hashedPassword, createdAt: new Date().toISOString() });
        await writeUsers(users, sha);
        res.status(201).json({ success: true, message: 'User created', username, email });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
}

app.get('/login/:username/:password', async (req, res) => {
    const { username, password } = req.params;
    await handleLogin(username, password, res);
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    await handleLogin(username, password, res);
});

async function handleLogin(username, password, res) {
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    try {
        const { users } = await readUsers();
        const user = users.find(u => u.username === username);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const token = jwt.sign({ username: user.username, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token, username: user.username, email: user.email, expiresIn: '7 days' });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

app.get('/verify/:token', async (req, res) => {
    const { token } = req.params;
    await handleVerify(token, res);
});

app.post('/verify', async (req, res) => {
    const { token } = req.body;
    await handleVerify(token, res);
});

async function handleVerify(token, res) {
    if (!token) {
        return res.status(400).json({ error: 'Token required' });
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        res.json({ valid: true, username: decoded.username, email: decoded.email, expiresAt: new Date(decoded.exp * 1000).toISOString() });
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ valid: false, error: 'Token expired' });
        }
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ valid: false, error: 'Invalid token' });
        }
        res.status(500).json({ error: 'Verification error' });
    }
}

app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString(), repo: REPO });
});

app.listen(PORT, () => {
    console.log(`🚀 API running on http://localhost:${PORT}`);
    console.log(`📁 GitHub repo: ${REPO}`);
});
