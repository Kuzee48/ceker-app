// File: server.js

const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const CryptoJS = require('crypto-js');
const jwt = require('jsonwebtoken');
const TelegramBot = require('node-telegram-bot-api');

// --- KONFIGURASI ---
const PORT = 3000;
const JWT_SECRET = 'alinaayggg'; // Ganti dengan secret key Anda
const DB_FILE = './database.json';

// --- KONFIGURASI TELEGRAM (GANTI DENGAN MILIK ANDA) ---
const TELEGRAM_BOT_TOKEN = '8339794356:AAGG3Rzt11Zq1Oz0gghnQJ5oXMexz_4bq-k';
const ADMIN_CHAT_ID = '5509296609'; // ID Telegram Anda

const app = express();
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

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

// --- Middleware untuk Otentikasi ---
const authMiddleware = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ message: 'Akses ditolak. Token tidak ada.' });
    }
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

// Rute Login
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

// Rute untuk mengecek akun MLBB (dilindungi middleware)
app.post('/api/check', authMiddleware, async (req, res) => {
    const { email, password, e_captcha } = req.body;

    const md5pwd = CryptoJS.MD5(password).toString();
    const rawSign = `account=${email}&e_captcha=${e_captcha}&md5pwd=${md5pwd}&op=login_captcha`;
    const sign = CryptoJS.MD5(rawSign).toString();

    const payload = {
        op: "login_captcha",
        lang: "en",
        sign: sign,
        params: { account: email, md5pwd: md5pwd, e_captcha: e_captcha }
    };

    try {
        const response = await fetch("https://accountmtapi.mobilelegends.com/", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        res.json(data); // Kirim respons dari API MLBB kembali ke frontend
    } catch (error) {
        console.error("Error saat proxying ke API MLBB:", error);
        res.status(500).json({ message: "Gagal menghubungi server Mobile Legends." });
    }
});


// Rute untuk halaman utama (setelah login)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// --- Logika Bot Telegram untuk Admin ---

bot.on('message', (msg) => {
    // Hanya proses pesan dari admin
    if (msg.chat.id.toString() !== ADMIN_CHAT_ID) {
        bot.sendMessage(msg.chat.id, "Anda tidak diizinkan menggunakan bot ini.");
        return;
    }

    const text = msg.text;
    const args = text.split(' ');
    const command = args[0];

    // /adduser <username> <password> <durasi_hari>
    if (command === '/adduser') {
        if (args.length !== 4) {
            return bot.sendMessage(ADMIN_CHAT_ID, "Format salah. Gunakan: /adduser <username> <password> <durasi_hari>");
        }
        const [, username, password, days] = args;
        const db = readDB();
        if (db.users[username]) {
            return bot.sendMessage(ADMIN_CHAT_ID, `Username "${username}" sudah ada.`);
        }
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + parseInt(days));

        db.users[username] = { password, expiry: expiryDate.toISOString() };
        writeDB(db);
        bot.sendMessage(ADMIN_CHAT_ID, `✅ Pengguna "${username}" berhasil ditambahkan. Aktif selama ${days} hari.`);
    }

    // /listusers
    else if (command === '/listusers') {
        const db = readDB();
        let message = "Daftar Pengguna:\n\n";
        for (const username in db.users) {
            const user = db.users[username];
            const expiry = new Date(user.expiry);
            const isExpired = expiry < new Date();
            message += `👤 Username: ${username}\n`;
            message += `   Password: ${user.password}\n`;
            message += `   Kedaluwarsa: ${expiry.toLocaleString('id-ID')}\n`;
            message += `   Status: ${isExpired ? '🔴 Kedaluwarsa' : '🟢 Aktif'}\n\n`;
        }
        bot.sendMessage(ADMIN_CHAT_ID, message || "Tidak ada pengguna terdaftar.");
    }
    
    // /deluser <username>
    else if (command === '/deluser') {
        if (args.length !== 2) {
            return bot.sendMessage(ADMIN_CHAT_ID, "Format salah. Gunakan: /deluser <username>");
        }
        const [, username] = args;
        const db = readDB();
        if (!db.users[username]) {
            return bot.sendMessage(ADMIN_CHAT_ID, `Username "${username}" tidak ditemukan.`);
        }
        delete db.users[username];
        writeDB(db);
        bot.sendMessage(ADMIN_CHAT_ID, `🗑️ Pengguna "${username}" berhasil dihapus.`);
    }
    
    // /extend <username> <durasi_hari>
    else if (command === '/extend') {
        if (args.length !== 3) {
            return bot.sendMessage(ADMIN_CHAT_ID, "Format salah. Gunakan: /extend <username> <durasi_hari>");
        }
        const [, username, days] = args;
        const db = readDB();
        if (!db.users[username]) {
            return bot.sendMessage(ADMIN_CHAT_ID, `Username "${username}" tidak ditemukan.`);
        }
        const newExpiry = new Date(db.users[username].expiry);
        newExpiry.setDate(newExpiry.getDate() + parseInt(days));
        db.users[username].expiry = newExpiry.toISOString();
        writeDB(db);
        bot.sendMessage(ADMIN_CHAT_ID, `✅ Langganan "${username}" berhasil diperpanjang ${days} hari.`);
    }

    else {
         bot.sendMessage(ADMIN_CHAT_ID, `
Bot Admin MLBB Checker
Perintah yang tersedia:
- /adduser <user> <pass> <hari>
- /listusers
- /deluser <user>
- /extend <user> <hari>
        `);
    }
});


app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
    bot.sendMessage(ADMIN_CHAT_ID, "🚀 Server checker berhasil dinyalakan!").catch(console.error);
});