/* Builds data/highspeed-rail.json: the world's high-speed rail lines (OpenStreetMap ways tagged
   railway=rail + highspeed=yes), merged into long lines, parallel tracks dropped, simplified for
   the Route map. Run occasionally (the network changes slowly):
     node data/build-highspeed-rail.js [rawCacheDir]
   Raw Overpass downloads are kept in rawCacheDir (default: OS temp) so a failed run can resume.
   Data © OpenStreetMap contributors, ODbL. */
const fs = require('fs');
const os = require('os');
const path = require('path');

const RAW = process.argv[2] || path.join(os.tmpdir(), 'trippo-hsr-raw');
const OUT = path.join(__dirname, 'highspeed-rail.json');
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
fs.mkdirSync(RAW, { recursive: true });

// [south, west, north, east, step]: split into step-degree tiles so each Overpass answer stays small
const REGIONS = [
    [20, 104, 42, 125, 5.5],   // eastern China (dense)
    [18, 97, 34, 104, 8],      // Yunnan, Sichuan, Guizhou west
    [42, 116, 50, 132, 8],     // northeast China
    [34, 73, 44, 104, 10],     // northwest China (Lanzhou-Xinjiang)
    [21, 119, 26, 123, 5],     // Taiwan
    [33, 125, 39, 130, 6],     // South Korea
    [30, 129, 46, 146, 6],     // Japan
    [35, -10, 62, 45, 9],      // Europe, Turkey, western Russia
    [30, -10, 36, -1, 6],      // Morocco
    [20, 37, 26, 42, 6],       // Saudi Arabia
    [37, 62, 43, 72, 10],      // Uzbekistan
    [-8, 105, -5, 109, 4],     // Indonesia (Jakarta-Bandung)
    [37, -80, 44, -69, 11]     // US Northeast Corridor
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
function tiles() {
    const out = [];
    for (const [s, w, n, e, step] of REGIONS) {
        for (let lat = s; lat < n; lat += step) for (let lon = w; lon < e; lon += step) {
            out.push([lat, lon, Math.min(n, lat + step), Math.min(e, lon + step)].map(v => Math.round(v * 100) / 100));
        }
    }
    return out;
}

async function fetchOnce(b, attempts) {
    const q = `[out:json][timeout:300];way["railway"="rail"]["highspeed"="yes"](${b.join(',')});out geom qt;`;
    let last = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
        const url = ENDPOINTS[attempt % ENDPOINTS.length];
        try {
            const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'trippo-highspeed-rail-build (trippo.top)' }, signal: AbortSignal.timeout(330000) });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const data = await r.json();
            if (data.remark && /runtime error|timed out|out of memory/i.test(data.remark)) throw new Error(data.remark);
            return data;
        } catch (e) {
            last = e;
            console.log(`  retry ${b.join(',')} (${e.message})`);
            await sleep(10000 * (attempt + 1));
        }
    }
    throw last;
}

// A tile the servers won't answer in one go is split into quarters (down to 1/64 of the original)
async function fetchTile(b, depth = 0) {
    const file = path.join(RAW, `${b.join('_')}.json`);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    let data;
    try {
        data = await fetchOnce(b, depth === 0 ? 2 : 4);
    } catch (e) {
        if (depth >= 3) throw new Error('gave up on tile ' + b.join(','));
        const [s, w, n, e2] = b;
        const mLat = Math.round((s + n) * 50) / 100, mLon = Math.round((w + e2) * 50) / 100;
        console.log(`  splitting ${b.join(',')}`);
        const elements = [];
        for (const part of [[s, w, mLat, mLon], [s, mLon, mLat, e2], [mLat, w, n, mLon], [mLat, mLon, n, e2]]) {
            elements.push(...((await fetchTile(part, depth + 1)).elements || []));
        }
        data = { elements };
    }
    fs.writeFileSync(file, JSON.stringify(data));
    return data;
}

// Douglas-Peucker on [lat, lon] points (degrees; fine at this tolerance)
function simplify(pts, tol) {
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
        const [a, b] = stack.pop();
        const [y1, x1] = pts[a], [y2, x2] = pts[b];
        const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
        let best = -1, bestD = tol * tol;
        for (let i = a + 1; i < b; i++) {
            const [y, x] = pts[i];
            const t = len2 ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2)) : 0;
            const ex = x1 + t * dx - x, ey = y1 + t * dy - y;
            const d = ex * ex + ey * ey;
            if (d > bestD) { bestD = d; best = i; }
        }
        if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
    }
    return pts.filter((_, i) => keep[i]);
}

// --cached-only: build from whatever tiles are already downloaded (e.g. to ship part of the world early)
const CACHED_ONLY = process.argv.includes('--cached-only');

(async () => {
    const ways = new Map(); // id -> { nodes, pts }
    const list = CACHED_ONLY
        ? fs.readdirSync(RAW).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5).split('_').map(Number))
        : tiles();
    for (let i = 0; i < list.length; i++) {
        const data = await fetchTile(list[i]);
        let added = 0;
        for (const el of data.elements || []) {
            if (el.type !== 'way' || !el.geometry || ways.has(el.id)) continue;
            ways.set(el.id, { nodes: el.nodes, pts: el.geometry.map(g => [g.lat, g.lon]) });
            added++;
        }
        console.log(`${i + 1}/${list.length} ${list[i].join(',')}: +${added} (total ${ways.size})`);
        await sleep(1500);
    }

    // Merge ways that meet end to end where exactly two ways share the node
    const ends = new Map();
    const addEnd = (node, id) => { if (!ends.has(node)) ends.set(node, []); ends.get(node).push(id); };
    for (const [id, w] of ways) { addEnd(w.nodes[0], id); addEnd(w.nodes[w.nodes.length - 1], id); }
    const used = new Set();
    const chains = [];
    for (const [id, w] of ways) {
        if (used.has(id)) continue;
        used.add(id);
        let nodes = [...w.nodes], pts = [...w.pts];
        for (const atEnd of [true, false]) {
            for (;;) {
                const node = atEnd ? nodes[nodes.length - 1] : nodes[0];
                const others = (ends.get(node) || []).filter(o => !used.has(o));
                if ((ends.get(node) || []).length !== 2 || others.length !== 1) break;
                const o = ways.get(others[0]);
                used.add(others[0]);
                let on = o.nodes, op = o.pts;
                if (atEnd) {
                    if (on[0] !== node) { on = [...on].reverse(); op = [...op].reverse(); }
                    nodes = nodes.concat(on.slice(1)); pts = pts.concat(op.slice(1));
                } else {
                    if (on[on.length - 1] !== node) { on = [...on].reverse(); op = [...op].reverse(); }
                    nodes = on.slice(0, -1).concat(nodes); pts = op.slice(0, -1).concat(pts);
                }
            }
        }
        chains.push(pts);
    }
    console.log(`${ways.size} ways -> ${chains.length} chains`);

    // Drop parallel tracks: longest lines first, skip a line that runs where one is already drawn
    const km = pts => pts.reduce((s, p, i) => i ? s + Math.hypot(p[0] - pts[i - 1][0], (p[1] - pts[i - 1][1]) * Math.cos(p[0] * Math.PI / 180)) * 111 : 0, 0);
    chains.sort((a, b) => km(b) - km(a));
    const CELL = 0.004;
    const grid = new Set();
    const cell = (lat, lon) => `${Math.round(lat / CELL)},${Math.round(lon / CELL)}`;
    const near = (lat, lon) => { const r = Math.round(lat / CELL), c = Math.round(lon / CELL); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if (grid.has(`${r + i},${c + j}`)) return true; return false; };
    const lines = [];
    for (const pts of chains) {
        const samples = [];
        for (let i = 0; i < pts.length; i++) {
            samples.push(pts[i]);
            if (i < pts.length - 1) {
                const [a, b] = [pts[i], pts[i + 1]];
                const steps = Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / (CELL / 2));
                for (let s = 1; s < steps; s++) samples.push([a[0] + (b[0] - a[0]) * s / steps, a[1] + (b[1] - a[1]) * s / steps]);
            }
        }
        const covered = samples.filter(([la, lo]) => near(la, lo)).length / samples.length;
        if (covered >= 0.85) continue;
        samples.forEach(([la, lo]) => grid.add(cell(la, lo)));
        const simple = simplify(pts, 0.0012);
        if (simple.length < 2 || km(simple) < 0.3) continue;
        const flat = [];
        let last = '';
        for (const [la, lo] of simple) {
            const k = `${la.toFixed(3)},${lo.toFixed(3)}`;
            if (k === last) continue;
            last = k;
            flat.push(Number(la.toFixed(3)), Number(lo.toFixed(3)));
        }
        if (flat.length >= 4) lines.push(flat);
    }
    const out = { generated: new Date().toISOString().slice(0, 10), source: 'OpenStreetMap contributors (ODbL), railway=rail + highspeed=yes', lines };
    fs.writeFileSync(OUT, JSON.stringify(out));
    console.log(`wrote ${lines.length} lines, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB -> ${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });
