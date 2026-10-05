# 🌐 Trippo Site & Infrastructure Management Directory
> **Website:** [trippo.top](https://trippo.top/)  
> **Last Updated:** October 2026 (v2.3.65)  
> **Spreadsheet Export:** A companion spreadsheet [`site-credentials-and-services.csv`](file:///c:/Users/Jacob/Desktop/trippo-site/site-credentials-and-services.csv) is available in the root folder to open directly in Microsoft Excel or Google Sheets.

---

## 📊 1. Master Service Directory & Accounts Spreadsheet

| Category | Service Name | Management / Login Dashboard | Account / ID | Key / Credential Reference | Purpose / What It Manages | Cost / Tier |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Domain & DNS** | **Spaceship** | [spaceship.com](https://www.spaceship.com/) | `trippo.top` | NS: `launch1.spaceship.net`<br>NS: `launch2.spaceship.net` | Domain registration, DNS A records (pointing to GitHub), WWW CNAME | ~$1.50 - $3.00/yr |
| **Web Hosting & CI/CD** | **GitHub Pages** | [GitHub Pages Settings](https://github.com/jacobgbroussard-code/trippo-site/settings/pages) | `jacobgbroussard-code`<br>Repo: `trippo-site` | Automatic builds from `main` branch | Serves the live web app, automated SSL certificate, PWA caching | **Free** |
| **Database & Cloud Sync** | **Supabase** | [Supabase Project Dashboard](https://supabase.com/dashboard/project/lbmxfczgvtznhfhzogla) | Ref: `lbmxfczgvtznhfhzogla` | `SUPABASE_ANON_KEY`<br>*(stored in `js/db.js`)* | User logins, cross-device sync for saved trips and wishlists | **Free Tier**<br>(500MB DB / 50k MAU) |
| **Maps & Search APIs** | **Google Cloud Platform** | [Google Maps Console](https://console.cloud.google.com/google/maps-apis) | GCP Project (Trippo) | API Key: `AIzaSyBMvlLs5sfzr...`<br>*(stored in `js/maps.js`)* | Google Places autocomplete, POI search, Street View images | **Free Tier**<br>($200/mo credit) |
| **Backup Web Host** | **Netlify** | [app.netlify.com](https://app.netlify.com/) | Account: `6abf5d2111...`<br>Site: `884d84e4-c5e0...` | `NETLIFY_AUTH_TOKEN`<br>*(stored in `.env`)* | Standby secondary host in case GitHub Pages is ever unavailable | **Free Tier** |
| **Map Tiles & Overlays** | **OpenStreetMap** | [openstreetmap.org](https://www.openstreetmap.org/) | Public Open Source | No account required | Base world street tiles and railway transit layers | **Free** |
| **Transit / Driving Routing**| **Project OSRM** | [project-osrm.org](http://project-osrm.org/) | Public Open Source | No account required | Walking & driving time estimates, road line geometry | **Free** |
| **Travel Partner** | **Trip.com** | [us.trip.com](https://us.trip.com/) | Embedded Link Templates | Deep links in `js/bookings.js` | Directs users to book hotels, flights, and trains | Free / Partner |
| **Travel Partner** | **Booking.com** | [booking.com](https://www.booking.com/) | Embedded Link Templates | Deep links in `js/bookings.js` | Directs users to check hotel prices | Free |
| **Travel Partner** | **Google Flights** | [google.com/travel/flights](https://www.google.com/travel/flights) | Embedded Link Templates | Deep links in `js/bookings.js` | Directs users to search flight dates and pricing | Free |

---

## 🛠️ 2. Detailed Service-by-Service Breakdown

### 1. Domain Registration & DNS (Spaceship)
* **Website:** [https://www.spaceship.com/](https://www.spaceship.com/)
* **Domain Name:** `trippo.top`
* **What you do here:**
  - **Renewal:** Check domain expiration once a year (typically renewed for ~$1.50 - $3.00/yr).
  - **DNS Records:** Directs internet traffic to GitHub's servers:
    - **A Records (for apex domain `trippo.top`):**
      - `185.199.108.153`
      - `185.199.109.153`
      - `185.199.110.153`
      - `185.199.111.153`
    - **CNAME Record (for `www.trippo.top`):**
      - Host: `www`  
      - Points to: `jacobgbroussard-code.github.io`

---

### 2. Primary Web Host & Automated Deployments (GitHub)
* **Main Repository:** [https://github.com/jacobgbroussard-code/trippo-site](https://github.com/jacobgbroussard-code/trippo-site)
* **GitHub Pages Settings:** [https://github.com/jacobgbroussard-code/trippo-site/settings/pages](https://github.com/jacobgbroussard-code/trippo-site/settings/pages)
* **Build / Deploy Actions:** [https://github.com/jacobgbroussard-code/trippo-site/actions](https://github.com/jacobgbroussard-code/trippo-site/actions)
* **How Deployment Works:**
  - Whenever you run `deploy-to-github.cmd` or push to the `main` branch, GitHub Actions builds and updates the live site in **~30 seconds**.
  - GitHub automatically manages and renews your free SSL/TLS certificate (HTTPS) for `trippo.top`.

---

### 3. Database & Cloud User Sync (Supabase)
* **Dashboard:** [https://supabase.com/dashboard/project/lbmxfczgvtznhfhzogla](https://supabase.com/dashboard/project/lbmxfczgvtznhfhzogla)
* **Project Reference:** `lbmxfczgvtznhfhzogla`
* **API URL:** `https://lbmxfczgvtznhfhzogla.supabase.co`
* **Public Anon Key:** Stored in [`js/db.js`](file:///c:/Users/Jacob/Desktop/trippo-site/js/db.js#L17)
* **What you do here:**
  - **Authentication:** View registered user accounts (emails, signup timestamps).
  - **Table Editor:** Inspect saved user trips (`trips` table) and destination wishlists (`wishlist_pins` table).
  - **Backups:** Supabase automatically creates daily database backups on the free tier.

---

### 4. Maps, Places Autocomplete & Street View (Google Cloud Platform)
* **Google Maps Console:** [https://console.cloud.google.com/google/maps-apis](https://console.cloud.google.com/google/maps-apis)
* **Credentials Page:** [https://console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
* **Billing Overview:** [https://console.cloud.google.com/billing](https://console.cloud.google.com/billing)
* **API Key:** `AIzaSyBMvlLs5sfzrIpQlgmzw1YqTcScgIyzLDg` (referenced in [`index.html`](file:///c:/Users/Jacob/Desktop/trippo-site/index.html#L49) and [`js/maps.js`](file:///c:/Users/Jacob/Desktop/trippo-site/js/maps.js#L31))
* **Active Google Services:**
  - **Places API (New & Classic):** Powers city search, hotel autocomplete, and daily attraction search.
  - **Maps JavaScript API:** Used for Google search integration and Street View popups.
  - **Street View Static API:** Loads real-world photographic previews for hotels and points of interest.
* **Cost / Quota:** Google provides a **$200 monthly free credit**, which covers tens of thousands of free autocomplete requests every month.

---

### 5. Backup / Standby Web Hosting (Netlify)
* **Dashboard:** [https://app.netlify.com/](https://app.netlify.com/)
* **Site ID:** `884d84e4-c5e0-4d92-b3c1-7b8313fa3333`
* **Token:** Stored safely in [`.env`](file:///c:/Users/Jacob/Desktop/trippo-site/.env)
* **Purpose:** Kept on standby as an emergency mirror/backup host.

---

## ⚡ 3. Everyday Commands & Maintenance Cheatsheet

### How to Deploy Updates Live
1. Make your edits in code or design.
2. Double-click the desktop shortcut or run:
   ```powershell
   node deploy-to-github.js
   ```
   *(Or run `.\deploy-to-github.cmd`)*
3. Check progress at [GitHub Actions](https://github.com/jacobgbroussard-code/trippo-site/actions). Your live site updates in ~30 seconds.

### How to Run the Site Locally for Testing
To test offline changes on your own computer without deploying:
```powershell
node dev-server.js
```
Then open: **`http://127.0.0.1:8080/`**

### How to Run the Automated QA Test Suite
To verify that all 23 regression checks pass before publishing:
```powershell
node tests/comprehensive-verify.js
node tests/test-transpacific-and-locking.js
node tests/audit.js
```

---

## 🚨 4. Emergency Troubleshooting Guide

| Issue | Cause | Fix |
| :--- | :--- | :--- |
| **Site says "Domain Expired"** | Spaceship registration ran out | Log in to [spaceship.com](https://www.spaceship.com/), click Domains, and renew `trippo.top` (~$2). |
| **Site says "404 Not Found"** | GitHub Pages custom domain unlinked | Go to [GitHub Pages Settings](https://github.com/jacobgbroussard-code/trippo-site/settings/pages) and re-enter `trippo.top` in the Custom domain box. |
| **Search dropdown says "API Error"** | Google Cloud quota or billing issue | Check [Google Maps Console](https://console.cloud.google.com/google/maps-apis) to ensure billing account is active. |
| **Cloud Sync fails to log in** | Supabase pause after 7 days of inactivity (free tier) | Log in to [Supabase Dashboard](https://supabase.com/dashboard/project/lbmxfczgvtznhfhzogla) and click "Restore / Wake Up Project". |
