# Deployment

Production target: AWS EC2 instance running on a subdomain (`vtt.<your-domain>`),
behind nginx with Let's Encrypt TLS, supervised by pm2 under the `ubuntu` user.

This pattern reuses the same pm2 + `~/services/<svc>/` layout as the rest of
the EC2 box's deployments — no dedicated user, no systemd unit. The trade-off
is some hardening (process isolation, NoNewPrivileges, etc.); fine for a
single-campaign personal app.

## One-time host setup (per subdomain)

Assumes nginx, certbot, Node, and pm2 are already installed on the EC2 box
(they are — they run the existing CS260 deployments).

On the EC2 box:

1. Copy the nginx site config into place. From the dev machine:

   ```bash
   scp -i <key> infra/nginx/vtt.conf ubuntu@<host>:/tmp/vtt.conf
   ssh -i <key> ubuntu@<host> sudo install -m 0644 /tmp/vtt.conf /etc/nginx/sites-available/vtt.conf
   ```

2. Edit `/etc/nginx/sites-available/vtt.conf` on the EC2 box and replace
   `vtt.example.com` (4 places) with your actual subdomain.

3. Enable the site and acquire a TLS cert:

   ```bash
   sudo ln -sf /etc/nginx/sites-available/vtt.conf /etc/nginx/sites-enabled/
   sudo certbot --nginx -d vtt.<your-domain>
   sudo nginx -t && sudo systemctl reload nginx
   ```

## Deploy

From the dev machine:

```bash
bash infra/scripts/deploy.sh -k <pem key> -h vtt.<your-domain>
```

What the script does:
1. `npm ci && npm run build` locally — produces `dist/server.js` and `public/`.
2. Stages `dist/`, `public/`, `package.json`, `package-lock.json` in a temp
   `build/` directory.
3. SSHes to the EC2 box, wipes `~/services/vtt/`, scp's the staged bundle in.
4. Runs `npm ci --omit=dev` on the box (pulls Express, Socket.IO, etc.).
5. `pm2 start dist/server.js --name vtt` (first time) or `pm2 restart vtt`
   (subsequent), then `pm2 save`.

The server listens on port 3000; nginx reverse-proxies the public subdomain
to `127.0.0.1:3000` and serves the static client out of
`/home/ubuntu/services/vtt/public`.

## First-deploy verification

After the script finishes, on your local machine:

```bash
curl https://vtt.<your-domain>/api/health
# → {"ok":true}
```

Then load `https://vtt.<your-domain>` in a browser. The page should show:

> Socket: connected — server says "connected"

If anything fails, check on the EC2 box:

- `pm2 logs vtt --lines 100`               — Node app logs
- `pm2 status`                             — process state
- `sudo tail -f /var/log/nginx/error.log`  — nginx errors

## What this milestone (M1) does NOT include

- Auth (no Basic Auth gates yet — `/dm` and `/` are publicly reachable).
- The migrations runner (`scripts/migrate.js`).
- SQLite, image uploads, anything stateful.
- Env file management (no `APP_SECRET` yet — comes in M2 along with auth).

These land in M2+.
