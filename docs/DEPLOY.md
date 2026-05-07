# Deployment

Production target: AWS EC2 instance under the `vtt.5edice.com` subdomain,
behind Caddy with auto-TLS, supervised by pm2 as the `ubuntu` user.

## One-time host setup (M2)

Run on the EC2 box.

1. **Install dependencies** (skip any already present):

   ```bash
   sudo apt update
   sudo apt install -y caddy nodejs rsync
   sudo npm install -g pm2
   ```

2. **Generate Basic Auth password hashes** (Caddy uses bcrypt). On any
   machine with Caddy installed, run:

   ```bash
   caddy hash-password
   ```

   You'll be prompted twice for a password and given back a `$2a$...` hash.
   Generate one for the DM password and one for the shared player password.

3. **Install the Caddy site config:**

   ```bash
   sudo mkdir -p /etc/caddy/sites
   sudo cp /path/to/repo/infra/caddy/Caddyfile.vtt /etc/caddy/sites/vtt.conf
   sudo nano /etc/caddy/sites/vtt.conf
   ```

   Replace `<DM_PASSWORD_HASH>` and `<PLAYER_PASSWORD_HASH>` with the bcrypt
   strings from step 2. Each placeholder appears in 2 places — search and
   replace all.

   Make sure the main `/etc/caddy/Caddyfile` includes this directory:

   ```
   import /etc/caddy/sites/*.conf
   ```

   Validate and reload:

   ```bash
   sudo caddy validate --config /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   ```

4. **Create the service directory and `.env`:**

   ```bash
   mkdir -p ~/services/vtt
   cp /path/to/repo/.env.example ~/services/vtt/.env
   chmod 600 ~/services/vtt/.env
   nano ~/services/vtt/.env
   ```

   Set `APP_SECRET` to the output of `openssl rand -hex 32`. Set
   `COOKIE_SECURE=1` (cookies will only flow over HTTPS in prod).

5. **Confirm pm2 starts at boot:**

   ```bash
   pm2 startup
   # paste the command pm2 prints
   ```

## Build & deploy

From your dev machine:

```bash
bash infra/scripts/deploy.sh -k ~/.ssh/your-ec2-key.pem -h vtt.5edice.com
```

The script:

- Builds (`npm ci && npm run build`)
- rsyncs `dist/`, `public/`, `migrations/`, `ecosystem.config.cjs`,
  `package.json`, `package-lock.json` to `~/services/vtt/`
- Preserves the existing `.env` and `vtt.sqlite*` on the host
- Runs `npm ci --omit=dev` on the host
- Runs `pm2 startOrReload ecosystem.config.cjs && pm2 save`

The migration runner runs at server startup — no separate migration step.

## First-deploy verification

After deploying:

```bash
curl https://vtt.5edice.com/api/health
# → 401 (Basic Auth challenge from Caddy — this is correct)

curl -u player:<player-password> https://vtt.5edice.com/api/health
# → {"ok":true}
```

In a browser:

1. Visit `https://vtt.5edice.com/dm`. Browser prompts for credentials. Use
   `dm` as the username and the DM password.
2. Page loads, JS calls `/api/dm/bootstrap`, cookie is set, page shows
   `Role: DM`.
3. Open another browser (or private window) and visit `https://vtt.5edice.com/`.
   Prompt for player credentials (`player` + shared password).
4. Page loads, name-picker appears. Submit a name.
5. Page shows `Hi, <name>!`.

## Troubleshooting

- `pm2 logs vtt` — Node process logs.
- `sudo journalctl -u caddy -n 100` — Caddy logs.
- `sudo caddy validate --config /etc/caddy/Caddyfile` — config check.
- If APP_SECRET isn't set, the Node process exits at startup with a clear
  error. Check `~/services/vtt/.env`.
- If you see `WebSocket connection failed`, confirm the `/socket.io/` block
  is in the Caddy site config and that `pm2 status` shows vtt running.

## Rotating credentials

- **Basic Auth password:** generate a new bcrypt hash with `caddy
  hash-password`, paste into `/etc/caddy/sites/vtt.conf`,
  `sudo systemctl reload caddy`. No Node restart needed.
- **APP_SECRET:** edit `~/services/vtt/.env`, then `pm2 restart vtt`. This
  invalidates *all* existing signed cookies — every connected DM/player
  must re-authenticate. That's the only revocation lever we have.

## What this milestone (M2) does NOT include

- Asset upload pipeline (sharp, image dedup) — M3.
- Pages / map management — M3.
- Tokens, drag-to-move, ownership rules — M4.
- Fog of war — M5.
- DM private preview, reconnect resync — M6.

These land in subsequent plans.
