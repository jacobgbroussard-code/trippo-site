const token = process.env.NETLIFY_AUTH_TOKEN || '';
const siteId = '884d84e4-c5e0-4d92-b3c1-7b8313fa3333';

async function checkDeploys() {
    const res = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys?per_page=10`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const deploys = await res.json();
    console.log(deploys.map(d => ({
        id: d.id,
        state: d.state,
        context: d.context,
        errorMessage: d.error_message,
        createdAt: d.created_at
    })));
}

checkDeploys().catch(console.error);
