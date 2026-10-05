const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const recipient = 'jacobgbroussard@gmail.com';
const subject = 'Trippo Site Management Directory & Accounts Cheat Sheet';

const bodyText = `TRIPPO SITE & INFRASTRUCTURE DIRECTORY
Website: https://trippo.top
Local Repo Folder: c:\\Users\\Jacob\\Desktop\\trippo-site

============================================================
1. DOMAIN & DNS (SPACESHIP)
============================================================
- Management Dashboard: https://www.spaceship.com/
- Domain: trippo.top
- Nameservers: launch1.spaceship.net, launch2.spaceship.net
- Key Task: Renew domain once a year (~$1.50 - $3.00/yr).
- DNS: A-records point to GitHub (185.199.108.153 etc), CNAME points to jacobgbroussard-code.github.io.

============================================================
2. WEB HOSTING & CI/CD (GITHUB)
============================================================
- Main Repo: https://github.com/jacobgbroussard-code/trippo-site
- GitHub Pages Settings: https://github.com/jacobgbroussard-code/trippo-site/settings/pages
- Build Logs (Actions): https://github.com/jacobgbroussard-code/trippo-site/actions
- Account: jacobgbroussard-code
- Key Task: Automatically builds and updates https://trippo.top/ in ~30 seconds whenever code is pushed to 'main'.

============================================================
3. DATABASE & CLOUD SYNC (SUPABASE)
============================================================
- Project Dashboard: https://supabase.com/dashboard/project/lbmxfczgvtznhfhzogla
- Project Reference: lbmxfczgvtznhfhzogla
- Project API URL: https://lbmxfczgvtznhfhzogla.supabase.co
- Key Task: Stores user authentication (login/signup) and syncs user trips/wishlists to the cloud. Free tier (500MB DB).

============================================================
4. GOOGLE MAPS & PLACES (GOOGLE CLOUD PLATFORM)
============================================================
- Console Dashboard: https://console.cloud.google.com/google/maps-apis
- Credentials Page: https://console.cloud.google.com/apis/credentials
- Billing Overview: https://console.cloud.google.com/billing
- Enabled Services: Places API, Maps JavaScript API, Street View Static API
- Key Task: Powers city search autocomplete and Street View photo previews. $200 monthly free credit covers thousands of searches.

============================================================
5. BACKUP WEB HOSTING (NETLIFY)
============================================================
- Dashboard: https://app.netlify.com/
- Site ID: 884d84e4-c5e0-4d92-b3c1-7b8313fa3333
- Key Task: Standby backup host in case GitHub Pages is ever unavailable.

============================================================
SPREADSHEET & DOCS ON YOUR COMPUTER:
============================================================
1. Excel Spreadsheet: c:\\Users\\Jacob\\Desktop\\trippo-site\\site-credentials-and-services.csv
2. Master Guide: c:\\Users\\Jacob\\Desktop\\trippo-site\\SITE_MANAGEMENT_DIRECTORY.md

To deploy updates anytime: run "node deploy-to-github.js" or double click deploy-to-github.cmd
`;

const gmailComposeUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(recipient)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
const mailtoUrl = `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;

console.log('--- GMAIL COMPOSE LINK ---');
console.log(gmailComposeUrl);

// Write out direct HTML launcher shortcut that opens Gmail with one click
const htmlLauncher = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Email Trippo Directory</title>
</head>
<body style="font-family: system-ui, sans-serif; max-width: 600px; margin: 40px auto; padding: 20px; line-height: 1.6;">
    <h2>📧 Email Trippo Site Directory to ${recipient}</h2>
    <p>Click below to open Gmail or your default email app with the complete directory pre-filled:</p>
    <p>
        <a href="${gmailComposeUrl}" target="_blank" style="display:inline-block; background:#124b43; color:white; padding:12px 20px; border-radius:10px; text-decoration:none; font-weight:bold; margin-right:12px;">✉️ Open in Gmail (Pre-filled)</a>
        <a href="${mailtoUrl}" style="display:inline-block; background:#e0f2fe; color:#0369a1; padding:12px 20px; border-radius:10px; text-decoration:none; font-weight:bold;">✉️ Open in Default Mail App</a>
    </p>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, 'email-to-jacob.html'), htmlLauncher);
console.log('\nWrote email launcher to tests/email-to-jacob.html');

// Try launching in default browser
try {
    execSync(`start "" "${gmailComposeUrl}"`, { shell: 'cmd.exe' });
    console.log('Successfully launched Gmail compose window!');
} catch (e) {
    console.log('Could not auto-launch browser:', e.message);
}
