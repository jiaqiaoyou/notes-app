# 笔记 (notes-app)

Multi-user notes on **Cloudflare Workers + D1** (not Vercel).

## Live

https://notes-app.jiaqiaoyou-notes.workers.dev/

(Old Pages URL https://notes-app-31j.pages.dev/ redirects here.)

## Features

- Username + password signup/login (no email/phone)
- Per-user notes in Cloudflare D1
- Session cookie (HttpOnly, Secure)
- Passwords hashed with PBKDF2-SHA256 (100k iterations)

## Local layout

- `src/worker.js` — API (auth + notes) + static serving entry
- `public/` — frontend (HTML/CSS/JS)
- `wrangler.toml` — D1 binding + assets config
- `migrations/0001_init.sql` — schema

## Deploy

```bash
# rebuild embedded bundle is optional; production uses Worker upload
npx wrangler deploy
```

Standing rule: final deploy step is always Cloudflare, never Vercel unless asked.
