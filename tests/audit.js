const fs = require('fs');
const path = require('path');

const indexHtml = fs.readFileSync('index.html', 'utf8');
const onclickMatches = [...indexHtml.matchAll(/onclick=["']([^"']+)["']/g)].map(m => m[1]);
const calledFns = [...new Set(onclickMatches.map(m => m.split('(')[0].trim()).filter(fn => !fn.startsWith('event.') && !fn.startsWith('window.') && !fn.startsWith('document.')))];

const jsDir = 'js';
const jsFiles = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));
const allExports = new Set();
for (const file of jsFiles) {
    const code = fs.readFileSync(path.join(jsDir, file), 'utf8');
    const exportMatches = [...code.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var)\s+([a-zA-Z0-9_$]+)/g)].map(m => m[1]);
    exportMatches.forEach(name => allExports.add(name));
}

console.log('Total exported functions/vars in js/:', allExports.size);
const missingFns = calledFns.filter(fn => !allExports.has(fn));
console.log('Functions called in index.html missing from exports:', missingFns);
