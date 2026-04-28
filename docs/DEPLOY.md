# Deployment

Production target: AWS EC2 instance running on `vtt.5edice.com`, behind Caddy
(auto-TLS), supervised by pm2 under the `ubuntu` user. Layout matches the
existing per-subdomain pattern on the box: `~/services/vtt/`.

## Prerequisites (one-time, manual)

Already in place on the EC2 box: nginx-replaced-by-Caddy, Node, pm2, the
DNS A record `vtt.5edice.com` pointing at the box.

## One-time setup for this subdomain

1. Add the Caddy site block to your Caddyfile. The contents are in
   [`infra/caddy/Caddyfile.vtt`](../infra/caddy/Caddyfile.vtt). Either paste
   them into your main `Caddyfile` or `import` the file from it.

2. Reload Caddy:

   ```bash
   sudo systemctl reload caddy
   # or, if running as a non-systemd service:
   sudo caddy reload --config /etc/caddy/Caddyfile
   ```

   On first request to `https://vtt.5edice.com`, Caddy will provision a Let's
   Encrypt cert automatically.

## Deploying

From the dev machine:

```bash
bash infra/scripts/deploy.sh -k <pem key> -h vtt.5edice.com
```

What the script does:
1. `npm ci && npm run build` locally — produces `dist/server.js` and `public/`.
2. Stages `dist/`, `public/`, `package.json`, `package-lock.json` in a temp
   `build/` directory.
3. SSHes to the EC2 box, wipes `~/services/vtt/`, scp's the staged bundle in.
4. `npm ci --omit=dev` on the box (pulls Express, Socket.IO, etc.).
5. `pm2 start dist/server.js --name vtt` (first time) or `pm2 restart vtt`
   (subsequent), then `pm2 save`.

The Node process listens on port 3002; Caddy serves the static client out of
`/home/ubuntu/services/vtt/public` and reverse-proxies `/api/*` and
`/socket.io/*` to `127.0.0.1:3002` (WebSocket upgrades handled automatically).

## First-deploy verification

After the script finishes, on your local machine:

```bash
curl https://vtt.5edice.com/api/health
# → {"ok":true}
```

Then load `https://vtt.5edice.com` in a browser. The page should show:

> Socket: connected — server says "connected"

If anything fails, check on the EC2 box:

- `pm2 logs vtt --lines 100`              — Node app logs
- `pm2 status`                            — process state
- `sudo journalctl -u caddy -n 100`       — Caddy logs (incl. cert acquisition)

## What this milestone (M1) does NOT include

- Auth (no Basic Auth gates yet — `/dm` and `/` are publicly reachable).
- The migrations runner (`scripts/migrate.js`).
- SQLite, image uploads, anything stateful.
- Env file management (no `APP_SECRET` yet — comes in M2 along with auth).

These land in M2+.
