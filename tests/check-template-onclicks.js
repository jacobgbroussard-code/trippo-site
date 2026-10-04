const fs = require('fs');
const path = require('path');

const jsDir = 'js';
const jsFiles = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));

// 1. Collect all exported names
const allExports = new Set();
for (const file of jsFiles) {
    const code = fs.readFileSync(path.join(jsDir, file), 'utf8');
    const exportMatches = [...code.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var)\s+([a-zA-Z0-9_$]+)/g)].map(m => m[1]);
    exportMatches.forEach(name => allExports.add(name));
}

// 2. Collect all onclick handlers inside JS template literals across all js files
const templateOnclicks = new Set();
for (const file of jsFiles) {
    const code = fs.readFileSync(path.join(jsDir, file), 'utf8');
    const matches = [...code.matchAll(/onclick=["']([^"']+)["']/g)].map(m => m[1]);
    matches.forEach(onclickCode => {
        // extract function name before (
        const fnName = onclickCode.split('(')[0].trim();
        if (fnName && !fnName.startsWith('event.') && !fnName.startsWith('window.') && !fnName.startsWith('document.')) {
            templateOnclicks.add(fnName);
        }
    });
}

console.log('Template onclick functions found in js/:', [...templateOnclicks]);
const missingTemplateFns = [...templateOnclicks].filter(fn => !allExports.has(fn));
console.log('Missing template onclick functions:', missingTemplateFns);
