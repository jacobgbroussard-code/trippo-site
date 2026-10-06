const token = process.env.NETLIFY_AUTH_TOKEN || '';

async function checkAccountDetails() {
    const accountId = '6abf5d2111b014b27dab4657';
    const res = await fetch(`https://api.netlify.com/api/v1/accounts/${accountId}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const d = await res.json();
    console.log('Account:', {
        type_name: d.type_name,
        plan_credits: d.plan_credits,
        credit_alert_percentage: d.credit_alert_percentage,
        usages_exceeded: d.usages_exceeded,
        configurable_limits_exceeded: d.configurable_limits_exceeded,
        sites_with_usage_exceeded: d.sites_with_usage_exceeded
    });
}

checkAccountDetails().catch(console.error);
