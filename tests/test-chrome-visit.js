const { execFile } = require('child_process');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

execFile(CHROME, [
    '--headless=new',
    '--host-resolver-rules=MAP trippo.top 185.199.108.153',
    '--dump-dom',
    'http://trippo.top'
], (err, stdout, stderr) => {
    if (err) {
        console.error('Error:', err.message);
    } else {
        console.log('Successfully fetched via GitHub direct IP in Chrome!');
        console.log('DOM length:', stdout.length);
        console.log('Title match:', stdout.match(/<title>.*?<\/title>/i)?.[0]);
    }
});
