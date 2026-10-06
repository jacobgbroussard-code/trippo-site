const token = process.env.NETLIFY_AUTH_TOKEN || '';
const siteId = '884d84e4-c5e0-4d92-b3c1-7b8313fa3333';

async function checkCredits() {
    // Check account usage
    const accountId = '6abf5d2111b014b27dab4657';
    const res = await fetch(`https://api.netlify.com/api/v1/accounts/${accountId}/bandwidth`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    console.log('Bandwidth status:', res.status, await res.text());

    // Check build minutes / credits
    const buildsRes = await fetch(`https://api.netlify.com/api/v1/accounts/${accountId}/builds/status`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    console.log('Build status:', buildsRes.status, await buildsRes.text());
}

checkCredits().catch(console.error);
