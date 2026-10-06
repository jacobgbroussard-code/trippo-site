/**
 * Trippo Remote Control Telegram Bridge
 * Zero-dependency background bot for controlling, debugging, testing, and deploying Trippo from your phone.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { exec, spawn } = require('child_process');

// Ensure Electron Node mode doesn't exit on stdin EOF
if (process.stdin && typeof process.stdin.resume === 'function') {
    try { process.stdin.resume(); } catch(e){}
}
setInterval(() => {}, 1000 * 60 * 60);

// Detect Node runtime binary
const NODE_BIN = fs.existsSync('C:\\Users\\Jacob\\AppData\\Roaming\\Antigravity\\bin\\agy-node.cmd')
    ? 'C:\\Users\\Jacob\\AppData\\Roaming\\Antigravity\\bin\\agy-node.cmd'
    : 'node';

// Load environment variables from .env
function loadEnv() {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        content.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                const [key, ...vals] = trimmed.split('=');
                if (key && vals.length > 0) {
                    process.env[key.trim()] = vals.join('=').trim();
                }
            }
        });
    }
}

loadEnv();

// Ensure Git binary directory is in PATH
const gitDir = 'C:\\Program Files\\Git\\cmd';
if (fs.existsSync(gitDir) && (!process.env.PATH || !process.env.PATH.includes(gitDir))) {
    process.env.PATH = `${gitDir};${process.env.PATH || ''}`;
}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_USER_ID = process.env.TELEGRAM_ALLOWED_USER_ID || '1287135724';
const BASE_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

if (!BOT_TOKEN) {
    console.error('❌ Error: TELEGRAM_BOT_TOKEN is missing in .env');
    console.log('👉 Create a bot via @BotFather on Telegram, then add TELEGRAM_BOT_TOKEN=your_token_here to .env');
    process.exit(1);
}

console.log('🤖 Starting Trippo Telegram Bridge...');
console.log(`🔒 Allowed User ID: ${ALLOWED_USER_ID}`);
console.log(`⚡ Node Binary: ${NODE_BIN}`);

const PID_FILE = path.join(__dirname, '.bot.pid');
try {
    fs.writeFileSync(PID_FILE, String(process.pid));
} catch (e) {}

function cleanupPid() {
    try {
        if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
    } catch (e) {}
}

process.on('exit', cleanupPid);
process.on('SIGINT', () => { cleanupPid(); process.exit(0); });
process.on('SIGTERM', () => { cleanupPid(); process.exit(0); });
process.on('uncaughtException', (err) => { console.error('Uncaught Exception:', err); });
process.on('unhandledRejection', (reason) => { console.error('Unhandled Rejection:', reason); });

// Local HTTP Control Server (for Dashboard)
const localServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    if (req.url === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'online',
            uptimeSeconds: Math.floor(process.uptime()),
            memoryMB: (process.memoryUsage().rss / 1024 / 1024).toFixed(1),
            allowedUserId: ALLOWED_USER_ID || 'unlocked',
            botUsername: 'jacob_trippo_bot'
        }));
        return;
    }

    if (req.url === '/analytics') {
        const logPath = 'C:\\Users\\Jacob\\.gemini\\antigravity-ide\\brain\\2e5f8455-2bd0-4c5a-8577-f678d97d0ff1\\.system_generated\\logs\\transcript.jsonl';
        let stats = {
            totalSteps: 0,
            userPrompts: 0,
            modelTurns: 0,
            toolCalls: 0,
            topTools: {},
            lastModel: 'Gemini 3.8 Flash (Medium)',
            sessionStart: null,
            lastActive: null
        };
        try {
            if (fs.existsSync(logPath)) {
                const content = fs.readFileSync(logPath, 'utf8');
                const lines = content.trim().split('\n');
                stats.totalSteps = lines.length;
                lines.forEach(l => {
                    try {
                        const j = JSON.parse(l);
                        if (!stats.sessionStart && j.created_at) stats.sessionStart = j.created_at;
                        if (j.created_at) stats.lastActive = j.created_at;
                        if (j.type === 'USER_INPUT') stats.userPrompts++;
                        if (j.type === 'PLANNER_RESPONSE') stats.modelTurns++;
                        if (j.content && j.content.includes('Model Selection')) {
                            const match = j.content.match(/Model Selection` from .* to (Gemini [^.]+)\./);
                            if (match) stats.lastModel = match[1];
                        }
                        if (j.tool_calls) {
                            j.tool_calls.forEach(tc => {
                                stats.topTools[tc.name] = (stats.topTools[tc.name] || 0) + 1;
                                stats.toolCalls++;
                            });
                        }
                    } catch(e){}
                });
            }
        } catch(err) {
            console.error('Analytics parse error:', err.message);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(stats));
        return;
    }

    if (req.url === '/stop') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'stopping' }));
        setTimeout(() => {
            cleanupPid();
            process.exit(0);
        }, 300);
        return;
    }

    res.writeHead(404);
    res.end('Not Found');
});

localServer.listen(8765, '127.0.0.1', () => {
    console.log('📡 Local control server listening at http://127.0.0.1:8765');
});

localServer.on('error', (err) => {
    console.warn('Local control server port conflict or error:', err.message);
});

// Telegram API Helper Functions
async function apiCall(method, body = {}) {
    try {
        const res = await fetch(`${BASE_URL}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return await res.json();
    } catch (err) {
        console.error(`API Call [${method}] Error:`, err.message);
        return { ok: false, error: err.message };
    }
}

async function sendMessage(chatId, text, options = {}) {
    return await apiCall('sendMessage', {
        chat_id: chatId,
        text: text,
        parse_mode: options.parse_mode || 'Markdown',
        reply_markup: options.reply_markup || undefined
    });
}

async function sendChatAction(chatId, action = 'typing') {
    return await apiCall('sendChatAction', { chat_id: chatId, action });
}

async function sendPhoto(chatId, filePath, caption = '') {
    if (!fs.existsSync(filePath)) {
        return sendMessage(chatId, `❌ File not found: ${filePath}`);
    }
    const fileData = fs.readFileSync(filePath);
    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('photo', new Blob([fileData]), path.basename(filePath));
    if (caption) formData.append('caption', caption);

    try {
        const res = await fetch(`${BASE_URL}/sendPhoto`, {
            method: 'POST',
            body: formData
        });
        return await res.json();
    } catch (err) {
        console.error('sendPhoto Error:', err.message);
        return { ok: false, error: err.message };
    }
}

// Command Handlers
async function handleStatus(chatId) {
    await sendChatAction(chatId, 'typing');
    exec('git log -1 --pretty=format:"%h - %s (%cr)" && git status -s', { cwd: __dirname }, (err, stdout) => {
        const mem = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);
        const uptime = Math.floor(process.uptime() / 60);
        
        let msg = `📱 *Trippo Workspace Status*\n\n`;
        msg += `⏱ *Uptime*: ${uptime} mins | 💾 *Memory*: ${mem} MB\n`;
        msg += `🌐 *Dev Server*: http://127.0.0.1:8080\n\n`;
        msg += `📦 *Git Status*:\n\`\`\`\n${stdout.trim() || 'Working directory clean'}\n\`\`\``;

        sendMessage(chatId, msg, {
            reply_markup: {
                keyboard: [
                    [{ text: '📸 Screenshot' }, { text: '🧪 Run Tests' }],
                    [{ text: '📊 Status' }, { text: '🚀 Deploy to GitHub' }]
                ],
                resize_keyboard: true
            }
        });
    });
}

async function handleScreenshot(chatId) {
    await sendChatAction(chatId, 'upload_photo');
    sendMessage(chatId, '📸 Capturing live mobile view from Chrome...');

    const screenshotScript = path.join(__dirname, 'tests', 'test-route-distances-and-settings.js');
    if (fs.existsSync(screenshotScript)) {
        exec(`"${NODE_BIN}" "${screenshotScript}"`, { cwd: __dirname }, async (err) => {
            const artifactDir = 'C:\\Users\\Jacob\\.gemini\\antigravity-ide\\brain\\2e5f8455-2bd0-4c5a-8577-f678d97d0ff1';
            const lightSnap = path.join(artifactDir, 'route-distances-light.png');
            if (fs.existsSync(lightSnap)) {
                await sendPhoto(chatId, lightSnap, '📱 Live Trippo Route View (v2.3.74)');
            } else {
                sendMessage(chatId, '⚠️ Could not capture screenshot. Check if dev server is running on :8080');
            }
        });
    } else {
        sendMessage(chatId, '⚠️ Screenshot test script not found.');
    }
}

async function handleRunTests(chatId, testName) {
    await sendChatAction(chatId, 'typing');
    const target = testName ? testName.trim() : 'tests/test-route-distances-and-settings.js';
    sendMessage(chatId, `🧪 *Running test suite*: \`${target}\`...`);

    exec(`"${NODE_BIN}" "${path.join(__dirname, target)}"`, { cwd: __dirname, timeout: 30000 }, async (err, stdout, stderr) => {
        if (err) {
            sendMessage(chatId, `❌ *Test Failed*:\n\`\`\`\n${(stderr || err.message).slice(0, 1500)}\n\`\`\``);
            return;
        }
        
        let summary = `✅ *Test Succeeded!*\n\`\`\`\n${stdout.slice(0, 1500)}\n\`\`\``;
        await sendMessage(chatId, summary);

        // Check if test generated screenshots to send
        const artifactDir = 'C:\\Users\\Jacob\\.gemini\\antigravity-ide\\brain\\2e5f8455-2bd0-4c5a-8577-f678d97d0ff1';
        const snaps = ['route-distances-light.png', 'user-settings-modal.png', 'route-distances-dark.png'];
        for (const snap of snaps) {
            const snapPath = path.join(artifactDir, snap);
            if (fs.existsSync(snapPath)) {
                await sendPhoto(chatId, snapPath, `📸 ${snap}`);
            }
        }
    });
}

async function handleDeploy(chatId) {
    await sendChatAction(chatId, 'typing');
    sendMessage(chatId, '🚀 *Deploying Trippo to GitHub Pages...*');

    exec(`"${NODE_BIN}" "${path.join(__dirname, 'deploy-to-github.js')}"`, { cwd: __dirname }, (err, stdout, stderr) => {
        if (err) {
            sendMessage(chatId, `❌ *Deploy Failed*:\n\`\`\`\n${(stderr || err.message).slice(0, 1500)}\n\`\`\``);
            return;
        }
        sendMessage(chatId, `🎉 *Deployed Successfully to GitHub Pages!*\n\`\`\`\n${stdout.slice(0, 1500)}\n\`\`\`\nLive URL: https://trippo.top`);
    });
}

async function handleCustomCommand(chatId, cmd) {
    await sendChatAction(chatId, 'typing');
    sendMessage(chatId, `⚙️ *Executing*: \`${cmd}\`...`);

    exec(cmd, { cwd: __dirname, shell: 'powershell.exe', timeout: 45000 }, (err, stdout, stderr) => {
        const out = stdout || stderr || (err ? err.message : 'Done (No output)');
        sendMessage(chatId, `\`\`\`\n${out.slice(0, 3800)}\n\`\`\``);
    });
}

// Process Incoming Messages
async function processMessage(msg) {
    const chatId = msg.chat.id;
    const userId = String(msg.from.id);
    const text = (msg.text || '').trim();

    // Security check
    if (ALLOWED_USER_ID && userId !== String(ALLOWED_USER_ID)) {
        console.warn(`⚠️ Blocked unauthorized user: ${userId} (@${msg.from.username})`);
        return sendMessage(chatId, `⛔ *Access Denied*: You are not authorized to control this Trippo instance.\n(User ID: \`${userId}\`)`);
    }

    if (!ALLOWED_USER_ID) {
        console.log(`ℹ️ First-time connection from User ID: ${userId} (@${msg.from.username})`);
        sendMessage(chatId, `👋 *Welcome to Trippo Remote Control!*\nYour Telegram User ID is: \`${userId}\`\n\nAdd this to your \`.env\`:\n\`TELEGRAM_ALLOWED_USER_ID=${userId}\`\nto lock down this bot.`);
    }

    console.log(`💬 [Telegram] ${msg.from.first_name || msg.from.username}: ${text}`);

    if (text === '/start' || text === '/help') {
        const help = `📱 *Trippo Remote Control Bot*\n\n` +
            `*Quick Commands*:\n` +
            `• 📊 *Status*: \`/status\` - Git status, server state & memory\n` +
            `• 📸 *Screenshot*: \`/screenshot\` - Capture live app view\n` +
            `• 🧪 *Tests*: \`/test\` - Run CDP browser test suite\n` +
            `• 🚀 *Deploy*: \`/deploy\` - Commit & push live to GitHub\n` +
            `• 🛑 *Turn Off*: \`/off\` or \`/stop\` - Shut down bridge remotely\n` +
            `• 💻 *Run Command*: \`/run <powershell command>\`\n` +
            `• 📝 *Direct Message*: Send any text to run custom tasks`;
        
        return sendMessage(chatId, help, {
            reply_markup: {
                keyboard: [
                    [{ text: '📸 Screenshot' }, { text: '🧪 Run Tests' }],
                    [{ text: '📊 Status' }, { text: '🚀 Deploy to GitHub' }],
                    [{ text: '🛑 Turn Off Bot' }]
                ],
                resize_keyboard: true
            }
        });
    }

    if (text === '🛑 Turn Off Bot' || text === '/stop' || text === '/off' || text === '/shutdown') {
        await sendMessage(chatId, '🛑 *Trippo Telegram Bridge is now OFF.* To restart it from your PC, double-click `start-telegram-bot.cmd` or `toggle-telegram-bot.cmd`.');
        cleanupPid();
        process.exit(0);
    }

    const lower = text.toLowerCase();
    if (lower === 'hi' || lower === 'hello' || lower === 'hey' || lower.includes('are you on') || lower === 'ping' || lower.includes('you there') || lower === 'online') {
        return sendMessage(chatId, `🟢 *Yes, I am online and listening!* Your Trippo workspace is live on your desktop.\n\nTap any button below or send a command:`, {
            reply_markup: {
                keyboard: [
                    [{ text: '📸 Screenshot' }, { text: '🧪 Run Tests' }],
                    [{ text: '📊 Status' }, { text: '🚀 Deploy to GitHub' }],
                    [{ text: '🛑 Turn Off Bot' }]
                ],
                resize_keyboard: true
            }
        });
    }

    if (text === '📊 Status' || text === '/status') {
        return handleStatus(chatId);
    }

    if (text === '📸 Screenshot' || text === '/screenshot') {
        return handleScreenshot(chatId);
    }

    if (text === '🧪 Run Tests' || text.startsWith('/test')) {
        const parts = text.split(' ');
        const testName = parts.length > 1 ? parts[1] : null;
        return handleRunTests(chatId, testName);
    }

    if (text === '🚀 Deploy to GitHub' || text === '/deploy') {
        return handleDeploy(chatId);
    }

    if (text.startsWith('/run ')) {
        const cmd = text.slice(5).trim();
        return handleCustomCommand(chatId, cmd);
    }

    if (text.startsWith('/git ')) {
        const gitCmd = `git ${text.slice(5).trim()}`;
        return handleCustomCommand(chatId, gitCmd);
    }

    if (text.startsWith('/cmd ')) {
        const cmd = text.slice(5).trim();
        return handleCustomCommand(chatId, cmd);
    }

    // Default: Handle as conversational message or Gemini AI prompt
    return handleConversationalPrompt(chatId, text);
}

async function handleConversationalPrompt(chatId, text) {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
        await sendChatAction(chatId, 'typing');
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;
            const prompt = `You are the AI coding assistant for Trippo (an offline-first travel planner web app with Leaflet maps, PWA caching, Trip.com/Travelpayouts integrations, and vanilla JS/CSS). The developer Jacob is messaging you remotely from his phone.\n\nKeep answers concise, helpful, and formatted for Telegram markdown.\n\nMessage: ${text}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }]
                })
            });
            const data = await res.json();
            const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (reply) {
                return sendMessage(chatId, reply);
            }
        } catch (e) {
            console.error('Gemini API call failed:', e.message);
        }
    }

    return sendMessage(chatId, `💬 *Message received*: "${text}"\n\n💡 *Quick Controls*:\n• To execute a terminal command on your PC: \`/run <command>\` (e.g. \`/run git status\`)\n• To chat with AI directly here: add a free \`GEMINI_API_KEY\` to your \`.env\`\n• Or tap any button below:`, {
        reply_markup: {
            keyboard: [
                [{ text: '📸 Screenshot' }, { text: '🧪 Run Tests' }],
                [{ text: '📊 Status' }, { text: '🚀 Deploy to GitHub' }],
                [{ text: '🛑 Turn Off Bot' }]
            ],
            resize_keyboard: true
        }
    });
}

// Long Polling Update Loop
let offset = 0;
let isFirstPoll = true;

async function pollUpdates() {
    try {
        const res = await apiCall('getUpdates', {
            offset: offset,
            timeout: 25
        });

        if (res.ok && Array.isArray(res.result)) {
            if (isFirstPoll) {
                isFirstPoll = false;
                // Acknowledge any past pending updates from previous runs
                for (const update of res.result) {
                    offset = Math.max(offset, update.update_id + 1);
                }
                console.log(`📡 Connected to Telegram. Flushed ${res.result.length} backlog updates.`);
            } else {
                for (const update of res.result) {
                    offset = Math.max(offset, update.update_id + 1);
                    if (update.message && (update.message.text || update.message.caption)) {
                        await processMessage(update.message);
                    }
                }
            }
        }
    } catch (err) {
        console.error('Polling loop error:', err.message);
        await new Promise(r => setTimeout(r, 2000));
    }

    setImmediate(pollUpdates);
}

// Start polling
pollUpdates();

// Notify allowed user on boot
if (ALLOWED_USER_ID) {
    sendMessage(ALLOWED_USER_ID, '🟢 *Trippo Remote Bot is ONLINE*\nYour PC bridge is active and ready.\n\nTap a quick action or send any message:', {
        reply_markup: {
            keyboard: [
                [{ text: '📸 Screenshot' }, { text: '🧪 Run Tests' }],
                [{ text: '📊 Status' }, { text: '🚀 Deploy to GitHub' }],
                [{ text: '🛑 Turn Off Bot' }]
            ],
            resize_keyboard: true
        }
    }).catch(() => {});
}
