// Memuat variabel dari file .env untuk pengembangan lokal
require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const CryptoJS = require('crypto-js');
const jwt = require('jsonwebtoken');
const TelegramBot = require('node-telegram-bot-api');

// --- KONFIGURASI ---
// Ambil dari Environment Variables saat di-deploy
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'RAHASIA_SANGAT_SULIT_DITEBAK';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const VERCEL_URL = process.env.VERCEL_URL;

// [FIX] Menggunakan direktori /tmp yang bisa ditulis di Vercel
const DB_FILE = path.join('/tmp', 'database.json');
const app = express();

// --- [FIX] Inisialisasi Bot yang Aman ---
let bot; // Deklarasikan bot di luar scope

if (TELEGRAM_BOT_TOKEN) {
    console.log("Token Telegram ditemukan, menginisialisasi bot.");
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

    if (VERCEL_URL) {
        const WEBHOOK_URL = `${VERCEL_URL}/api/telegram`;
        bot.setWebhook(WEBHOOK_URL)
           .then(() => console.log(`Webhook berhasil diatur ke ${WEBHOOK_URL}`))
           .catch(err => console.error('Gagal mengatur webhook:', err.message));
    } else {
        console.warn("PERINGATAN: VERCEL_URL tidak ditemukan, webhook tidak bisa diatur secara otomatis.");
    }
} else {
    console.error("KRITIS: TELEGRAM_BOT_TOKEN tidak ditemukan di Environment Variables. Fitur bot dinonaktifkan.");
}
// --- Akhir Inisialisasi Bot ---

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());

// --- Fungsi Helper Database ---
function readDB() {
    if (!fs.existsSync(DB_FILE)) {
        console.log("Membuat database.json baru di /tmp");
        fs.writeFileSync(DB_FILE, JSON.stringify({ users: {} }));
    }
    return JSON.parse(fs.readFileSync(DB_FILE));
}

function writeDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// --- Middleware Otentikasi ---
const authMiddleware = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Akses ditolak.' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const db = readDB();
        const user = db.users[decoded.username];
        if (!user || new Date(user.expiry) < new Date()) {
             return res.status(401).json({ message: 'Akun tidak valid atau langganan telah berakhir.' });
        }
        req.user = decoded;
        next();
    } catch (error) {
        res.status(400).json({ message: 'Token tidak valid.' });
    }
};

// --- Rute API ---
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const db = readDB();
    const user = db.users[username];

    if (!user || user.password !== password) {
        return res.status(401).json({ message: 'Username atau password salah.' });
    }
    if (new Date(user.expiry) < new Date()) {
        return res.status(403).json({ message: 'Langganan Anda telah berakhir.' });
    }
    const token = jwt.sign({ username: username }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ message: 'Login berhasil!', token });
});

app.post('/api/check', authMiddleware, async (req, res) => {
    const { email, password, e_captcha } = req.body;
    const md5pwd = CryptoJS.MD5(password).toString();
    const rawSign = `account=${email}&e_captcha=${e_captcha}&md5pwd=${md5pwd}&op=login_captcha`;
    const sign = CryptoJS.MD5(rawSign).toString();
    const payload = { op: "login_captcha", lang: "en", sign, params: { account: email, md5pwd, e_captcha } };
    try {
        const response = await fetch("https://accountmtapi.mobilelegends.com/", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: "Gagal menghubungi server Mobile Legends." });
    }
});

// Endpoint untuk menerima update dari Webhook Telegram
app.post('/api/telegram', (req, res) => {
    // Pastikan bot berhasil diinisialisasi sebelum memproses update
    if (bot) {
        bot.processUpdate(req.body);
    }
    res.sendStatus(200); // Selalu balas 200 OK ke Telegram
});

// Rute untuk halaman login
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// --- Logika Bot Telegram (hanya berjalan jika bot berhasil dibuat) ---
if (bot) {
    bot.on('message', (msg) => {
        if (!ADMIN_CHAT_ID || msg.chat.id.toString() !== ADMIN_CHAT_ID) {
            console.log(`Pesan dari non-admin diabaikan: ${msg.chat.id}`);
            return bot.sendMessage(msg.chat.id, "Anda tidak diizinkan menggunakan bot ini.");
        }
        const text = msg.text || '';
        const args = text.split(' ');
        const command = args[0];

        if (command === '/adduser') {
            if (args.length !== 4) return bot.sendMessage(ADMIN_CHAT_ID, "Format: /adduser <user> <pass> <hari>");
            const [, username, password, days] = args;
            const db = readDB();
            if (db.users[username]) return bot.sendMessage(ADMIN_CHAT_ID, `Username "${username}" sudah ada.`);
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + parseInt(days));
            db.users[username] = { password, expiry: expiryDate.toISOString() };
            writeDB(db);
            bot.sendMessage(ADMIN_CHAT_ID, `✅ Pengguna "${username}" berhasil ditambah. Aktif ${days} hari.`);
        } else if (command === '/listusers') {
            const db = readDB();
            let message = "Daftar Pengguna:\n\n";
            Object.keys(db.users).forEach(username => {
                const user = db.users[username];
                const expiry = new Date(user.expiry);
                const isExpired = expiry < new Date();
                message += `👤 *User:* \`${username}\`\n`;
                message += `   🔑 *Pass:* \`${user.password}\`\n`;
                message += `   ⏰ *Kedaluwarsa:* ${expiry.toLocaleString('id-ID')}\n`;
                message += `   📈 *Status:* ${isExpired ? '🔴 Kedaluwarsa' : '🟢 Aktif'}\n\n`;
            });
            bot.sendMessage(ADMIN_CHAT_ID, message || "Tidak ada pengguna.", { parse_mode: 'Markdown' });
        } else if (command === '/deluser') {
            if (args.length !== 2) return bot.sendMessage(ADMIN_CHAT_ID, "Format: /deluser <username>");
            const [, username] = args;
            const db = readDB();
            if (!db.users[username]) return bot.sendMessage(ADMIN_CHAT_ID, `Username "${username}" tidak ditemukan.`);
            delete db.users[username];
            writeDB(db);
            bot.sendMessage(ADMIN_CHAT_ID, `🗑️ Pengguna "${username}" berhasil dihapus.`);
        } else if (command === '/extend') {
            if (args.length !== 3) return bot.sendMessage(ADMIN_CHAT_ID, "Format: /extend <username> <hari>");
            const [, username, days] = args;
            const db = readDB();
            if (!db.users[username]) return bot.sendMessage(ADMIN_CHAT_ID, `Username "${username}" tidak ditemukan.`);
            const expiry = new Date(db.users[username].expiry);
            const baseDate = expiry < new Date() ? new Date() : expiry;
            baseDate.setDate(baseDate.getDate() + parseInt(days));
            db.users[username].expiry = baseDate.toISOString();
            writeDB(db);
            bot.sendMessage(ADMIN_CHAT_ID, `✅ Langganan "${username}" diperpanjang ${days} hari.`);
        } else if (command === '/start' || command === '/help') {
             bot.sendMessage(ADMIN_CHAT_ID, `
*Bot Admin MLBB Checker*
Perintah yang tersedia:
- \`/adduser <user> <pass> <hari>\`
- \`/listusers\`
- \`/deluser <user>\`
- \`/extend <user> <hari>\`
            `, { parse_mode: 'Markdown' });
        }
    });
}

// Jalankan server (hanya untuk local, Vercel menanganinya sendiri)
module.exports = app;
// Jika Anda ingin menjalankannya secara lokal, Anda bisa menambahkan ini:
// app.listen(PORT, () => {
//     console.log(`Server lokal berjalan di http://localhost:${PORT}`);
// });app.use(bodyParser.json());

// --- Fungsi Helper Database ---
function readDB() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ users: {} }));
    }
    return JSON.parse(fs.readFileSync(DB_FILE));
}

function writeDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// --- Middleware Otentikasi ---
const authMiddleware = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Akses ditolak.' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const db = readDB();
        const user = db.users[decoded.username];
        if (!user || new Date(user.expiry) < new Date()) {
             return res.status(401).json({ message: 'Akun tidak valid atau langganan telah berakhir.' });
        }
        req.user = decoded;
        next();
    } catch (error) {
        res.status(400).json({ message: 'Token tidak valid.' });
    }
};

// --- Rute API ---
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const db = readDB();
    const user = db.users[username];

    if (!user || user.password !== password) {
        return res.status(401).json({ message: 'Username atau password salah.' });
    }
    if (new Date(user.expiry) < new Date()) {
        return res.status(403).json({ message: 'Langganan Anda telah berakhir.' });
    }
    const token = jwt.sign({ username: username }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ message: 'Login berhasil!', token });
});

app.post('/api/check', authMiddleware, async (req, res) => {
    const { email, password, e_captcha } = req.body;
    const md5pwd = CryptoJS.MD5(password).toString();
    const rawSign = `account=${email}&e_captcha=${e_captcha}&md5pwd=${md5pwd}&op=login_captcha`;
    const sign = CryptoJS.MD5(rawSign).toString();
    const payload = { op: "login_captcha", lang: "en", sign, params: { account: email, md5pwd, e_captcha } };
    try {
        const response = await fetch("https://accountmtapi.mobilelegends.com/", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: "Gagal menghubungi server Mobile Legends." });
    }
});

// Endpoint untuk menerima update dari Webhook Telegram
app.post('/api/telegram', (req, res) => {
    if (TELEGRAM_BOT_TOKEN) {
        bot.processUpdate(req.body);
    }
    res.sendStatus(200);
});

// Rute untuk halaman login
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// --- Logika Bot Telegram (dipicu oleh processUpdate) ---
if (TELEGRAM_BOT_TOKEN) {
    bot.on('message', (msg) => {
        if (msg.chat.id.toString() !== ADMIN_CHAT_ID) {
            return bot.sendMessage(msg.chat.id, "Anda tidak diizinkan menggunakan bot ini.");
        }
        const text = msg.text || '';
        const args = text.split(' ');
        const command = args[0];

        if (command === '/adduser') {
            if (args.length !== 4) return bot.sendMessage(ADMIN_CHAT_ID, "Format: /adduser <user> <pass> <hari>");
            const [, username, password, days] = args;
            const db = readDB();
            if (db.users[username]) return bot.sendMessage(ADMIN_CHAT_ID, `Username "${username}" sudah ada.`);
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + parseInt(days));
            db.users[username] = { password, expiry: expiryDate.toISOString() };
            writeDB(db);
            bot.sendMessage(ADMIN_CHAT_ID, `✅ Pengguna "${username}" berhasil ditambah. Aktif ${days} hari.`);
        } else if (command === '/listusers') {
            const db = readDB();
            let message = "Daftar Pengguna:\n\n";
            Object.keys(db.users).forEach(username => {
                const user = db.users[username];
                const expiry = new Date(user.expiry);
                const isExpired = expiry < new Date();
                message += `👤 *User:* \`${username}\`\n`;
                message += `   🔑 *Pass:* \`${user.password}\`\n`;
                message += `   ⏰ *Kedaluwarsa:* ${expiry.toLocaleString('id-ID')}\n`;
                message += `   📈 *Status:* ${isExpired ? '🔴 Kedaluwarsa' : '🟢 Aktif'}\n\n`;
            });
            bot.sendMessage(ADMIN_CHAT_ID, message || "Tidak ada pengguna.", { parse_mode: 'Markdown' });
        } else if (command === '/deluser') {
            if (args.length !== 2) return bot.sendMessage(ADMIN_CHAT_ID, "Format: /deluser <username>");
            const [, username] = args;
            const db = readDB();
            if (!db.users[username]) return bot.sendMessage(ADMIN_CHAT_ID, `Username "${username}" tidak ditemukan.`);
            delete db.users[username];
            writeDB(db);
            bot.sendMessage(ADMIN_CHAT_ID, `🗑️ Pengguna "${username}" berhasil dihapus.`);
        } else if (command === '/extend') {
            if (args.length !== 3) return bot.sendMessage(ADMIN_CHAT_ID, "Format: /extend <username> <hari>");
            const [, username, days] = args;
            const db = readDB();
            if (!db.users[username]) return bot.sendMessage(ADMIN_CHAT_ID, `Username "${username}" tidak ditemukan.`);
            const expiry = new Date(db.users[username].expiry);
            const baseDate = expiry < new Date() ? new Date() : expiry;
            baseDate.setDate(baseDate.getDate() + parseInt(days));
            db.users[username].expiry = baseDate.toISOString();
            writeDB(db);
            bot.sendMessage(ADMIN_CHAT_ID, `✅ Langganan "${username}" diperpanjang ${days} hari.`);
        } else if (command === '/start' || command === '/help') {
             bot.sendMessage(ADMIN_CHAT_ID, `
*Bot Admin MLBB Checker*
Perintah yang tersedia:
- \`/adduser <user> <pass> <hari>\`
- \`/listusers\`
- \`/deluser <user>\`
- \`/extend <user> <hari>\`
            `, { parse_mode: 'Markdown' });
        }
    });
}

// Jalankan server
app.listen(PORT, () => {
    console.log(`Server berjalan di port ${PORT}`);
});
