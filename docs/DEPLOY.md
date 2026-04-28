# Deployment

Production target: AWS EC2 instance running on a subdomain (`vtt.<your-domain>`),
behind nginx with Let's Encrypt TLS, supervised by systemd.

## One-time host setup

On the EC2 box:

1. Install dependencies:

   ```bash
   sudo apt update
   sudo apt install -y nginx nodejs certbot python3-certbot-nginx apache2-utils
   ```

2. Clone or copy this repo (anywhere; it's only needed for the setup script):

   ```bash
   git clone <repo-url> /tmp/vtt-setup   # or scp the repo over
   ```

3. Run the setup script (idempotent):

   ```bash
   sudo bash /tmp/vtt-setup/infra/scripts/setup-host.sh
   ```

4. Edit the nginx site config at `/etc/nginx/sites-available/vtt.conf` and
   replace `vtt.example.com` with your actual subdomain (4 places).

5. Generate the app secret:

   ```bash
   echo "APP_SECRET=$(openssl rand -hex 32)" | sudo tee -a /etc/vtt/env
   ```

6. Enable the nginx site and acquire a TLS certificate:

   ```bash
   sudo ln -sf /etc/nginx/sites-available/vtt.conf /etc/nginx/sites-enabled/
   sudo certbot --nginx -d vtt.<your-domain>
   sudo nginx -t && sudo systemctl reload nginx
   ```

## Build & deploy

The author has an existing per-subdomain deploy script for this EC2 instance.
Adapt that script to handle these VTT-specific steps:

**On the dev machine (pre-deploy):**

```bash
npm ci
npm run build      # produces dist/server.js + public/
```

**Files to ship to the EC2 box:**

- `dist/`               → `/opt/vtt/dist/`
- `public/`             → `/opt/vtt/public/`
- `package.json`        → `/opt/vtt/package.json`
- `package-lock.json`   → `/opt/vtt/package-lock.json`

(Don't ship `node_modules/` — `npm ci --omit=dev` runs on the EC2 box.)

**On the EC2 box (post-transfer):**

```bash
cd /opt/vtt
sudo -u vtt npm ci --omit=dev
sudo systemctl restart vtt
```

(Once migrations land in M2, this becomes:
`sudo -u vtt node /opt/vtt/dist/scripts/migrate.js && sudo systemctl restart vtt`.)

## First-deploy verification

After deploying, on your local machine:

```bash
curl https://vtt.<your-domain>/api/health
# → {"ok":true}
```

Then load `https://vtt.<your-domain>` in a browser. The page should show:

> Socket: connected — server says "connected"

If anything fails, check:

- `sudo journalctl -u vtt -n 100`           — Node app logs
- `sudo tail -f /var/log/nginx/error.log`   — nginx errors
- `sudo systemctl status vtt`               — service state

## Logs

App stdout/stderr land in `/var/log/vtt/app.log` (configured in the systemd
unit). Add a logrotate entry once volume warrants it.

## What this milestone (M1) does NOT include

- Auth (no Basic Auth gates yet — `/dm` and `/` are publicly reachable).
- The migrations runner (`scripts/migrate.js`).
- SQLite, image uploads, anything stateful.

These land in M2+.
