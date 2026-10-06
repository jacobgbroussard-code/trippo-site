const token = process.env.NETLIFY_AUTH_TOKEN || '';
const siteId = '884d84e4-c5e0-4d92-b3c1-7b8313fa3333';

async function checkSite() {
    const res = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const site = await res.json();
    console.log('Site name:', site.name);
    console.log('Site URL:', site.url);
    console.log('Published deploy ID:', site.published_deploy ? site.published_deploy.id : null);
    console.log('Published deploy context:', site.published_deploy ? site.published_deploy.context : null);
    console.log('Published deploy created at:', site.published_deploy ? site.published_deploy.created_at : null);
}

checkSite().catch(console.error);
