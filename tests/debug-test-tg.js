const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
const env = {};
if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
        const [k, ...v] = line.trim().split('=');
        if (k && v.length) env[k.trim()] = v.join('=').trim();
    });
}

const token = env.TELEGRAM_BOT_TOKEN;
const userId = env.TELEGRAM_ALLOWED_USER_ID;

console.log('Token exists:', !!token, 'Token prefix:', token ? token.slice(0, 10) : 'none');
console.log('User ID:', userId);

async function run() {
    try {
        console.log('--- 1. Testing getMe ---');
        const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
        const me = await meRes.json();
        console.log('getMe:', JSON.stringify(me));

        console.log('--- 2. Testing getUpdates ---');
        const updRes = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
        const upd = await updRes.json();
        console.log('getUpdates count:', upd.result ? upd.result.length : 0);
        if (upd.result && upd.result.length > 0) {
            console.log('Latest update:', JSON.stringify(upd.result[upd.result.length - 1], null, 2));
        }

        console.log('--- 3. Testing local server :8765 ---');
        try {
            const locRes = await fetch('http://127.0.0.1:8765/status');
            const loc = await locRes.json();
            console.log('Local status:', JSON.stringify(loc));
        } catch (e) {
            console.log('Local status: Offline or unreachable (' + e.message + ')');
        }

        console.log('--- 4. Sending verification ping ---');
        const sendRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: userId,
                text: '🧪 *Trippo Bot Diagnostic Ping*\n\nTesting connection from workspace. If you see this, Telegram Bot API delivery is 100% operational!',
                parse_mode: 'Markdown'
            })
        });
        const sendJson = await sendRes.json();
        console.log('Send message result:', JSON.stringify(sendJson));

    } catch (err) {
        console.error('Diagnostic error:', err);
    }
}

run();
