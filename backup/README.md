# Cloud backups

- `.github/workflows/cloud-backup.yml` saves an encrypted copy of every Supabase table each Sunday
  (GitHub → Actions → Cloud backup → a run → Artifacts). Each one is kept 90 days.
- Encryption happens inside Supabase (`supabase/cloud-backup.sql`) with `public-key.asc`.
- The **private key** is only on the owner's PC: `Documents\Trippo backup key\`. Keep a copy of that
  folder in iCloud/Google Drive — without it the backups can't be opened.

## Opening a backup
1. Download the artifact zip and unzip it (you get `trippo-backup.asc`).
2. Drag `trippo-backup.asc` onto `Documents\Trippo backup key\decrypt-backup.cmd`.
3. You get `trippo-backup.json` next to it: `{ created_at, trips: [...], wishlist: [...], ... }`.

On a new PC, import the key first (needs Git for Windows):
`gpg --import trippo-backup-private-key.asc`, then `gpg -d trippo-backup.asc > trippo-backup.json`.
