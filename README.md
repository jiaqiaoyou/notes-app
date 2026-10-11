# 笔记 (kio)

Multi-user notes on **Cloudflare Workers + D1** (not Vercel).

## Live

**https://kio.kioapp.workers.dev/**

Worker name: `kio` · Account workers.dev subdomain: `kioapp`

Note: exact account subdomain `kio` was unavailable (taken). Shortest available combo is `kio.kioapp.workers.dev`.

## Features

- Username + password signup/login (no email/phone)
- Per-user notes in Cloudflare D1
- Session cookie (HttpOnly, Secure)
- Passwords: PBKDF2-SHA256

## Deploy

```bash
npx wrangler deploy
```

Standing rule: Cloudflare only — never Vercel unless asked.
