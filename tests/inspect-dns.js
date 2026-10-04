const dns = require('dns').promises;
require('dns').setServers(['8.8.8.8', '1.1.1.1']);

async function checkDNS() {
    console.log('=== Checking trippo.top DNS Details ===');
    try {
        const a = await dns.resolve4('trippo.top');
        console.log('A records for trippo.top:', a);
    } catch (e) { console.log('A trippo.top:', e.code); }

    try {
        const aaaa = await dns.resolve6('trippo.top');
        console.log('AAAA records for trippo.top:', aaaa);
    } catch (e) { console.log('AAAA trippo.top:', e.code); }

    try {
        const caa = await dns.resolveCaa('trippo.top');
        console.log('CAA records for trippo.top:', caa);
    } catch (e) { console.log('CAA trippo.top:', e.code); }

    console.log('\n=== Checking www.trippo.top DNS Details ===');
    try {
        const cname = await dns.resolveCname('www.trippo.top');
        console.log('CNAME for www.trippo.top:', cname);
    } catch (e) { console.log('CNAME www.trippo.top:', e.code); }

    try {
        const aWww = await dns.resolve4('www.trippo.top');
        console.log('A records for www.trippo.top:', aWww);
    } catch (e) { console.log('A www.trippo.top:', e.code); }

    try {
        const aaaaWww = await dns.resolve6('www.trippo.top');
        console.log('AAAA records for www.trippo.top:', aaaaWww);
    } catch (e) { console.log('AAAA www.trippo.top:', e.code); }

    try {
        const caaWww = await dns.resolveCaa('www.trippo.top');
        console.log('CAA records for www.trippo.top:', caaWww);
    } catch (e) { console.log('CAA www.trippo.top:', e.code); }
}

checkDNS();
