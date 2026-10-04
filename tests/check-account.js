const token = 'nfp_pdGK4Xc1vHW7QLzxQcfEScFbdZGfkKGD9d14';
const siteId = '884d84e4-c5e0-4d92-b3c1-7b8313fa3333';

async function testDeploy() {
    // Check account / team credit status
    const accountsRes = await fetch('https://api.netlify.com/api/v1/accounts', {
        headers: { Authorization: `Bearer ${token}` }
    });
    const accounts = await accountsRes.json();
    console.log('Accounts:', accounts);
}

testDeploy().catch(console.error);
