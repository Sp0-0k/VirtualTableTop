#!/usr/bin/env bash
# One-time host setup for the VTT app on EC2 (Ubuntu).
# Idempotent: safe to re-run.
#
# Usage (on the EC2 box):
#   sudo bash infra/scripts/setup-host.sh
#
# What it does:
#   - creates the `vtt` system user and group
#   - creates /opt/vtt, /var/lib/vtt/uploads, /var/log/vtt, /etc/vtt
#   - copies the systemd unit and nginx site config into place (does NOT enable
#     them — that's a separate manual step so you can review first)
#   - leaves /etc/vtt/env for you to populate with secrets
#
# Does NOT do (out of scope for M1):
#   - install dependencies (do `sudo apt install nginx nodejs certbot python3-certbot-nginx`)
#   - run certbot (do `sudo certbot --nginx -d <your-subdomain>` after editing
#     vtt.conf to use your real subdomain)
#   - generate APP_SECRET (do `echo "APP_SECRET=$(openssl rand -hex 32)" | sudo tee -a /etc/vtt/env`)
#   - install/build the application (deploy script handles that)

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Must run as root (use sudo)." >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "[setup-host] using repo at $REPO_ROOT"

# 1. User and group
if ! id -u vtt >/dev/null 2>&1; then
  echo "[setup-host] creating user vtt"
  useradd --system --home /opt/vtt --shell /usr/sbin/nologin vtt
else
  echo "[setup-host] user vtt already exists"
fi

# 2. Directories
install -d -o vtt -g vtt -m 0755 /opt/vtt
install -d -o vtt -g vtt -m 0755 /var/lib/vtt /var/lib/vtt/uploads
install -d -o vtt -g vtt -m 0755 /var/log/vtt
install -d -o root -g root -m 0755 /etc/vtt

# 3. Env file (only create if missing — never overwrite)
if [[ ! -f /etc/vtt/env ]]; then
  echo "[setup-host] creating placeholder /etc/vtt/env (populate before starting service)"
  cat > /etc/vtt/env <<'EOF'
NODE_ENV=production
PORT=3000
# APP_SECRET is REQUIRED. Generate with: openssl rand -hex 32
# APP_SECRET=
CAMPAIGN_NAME=The Campaign
COOKIE_SECURE=1
TRUST_PROXY=1
EOF
  chown root:vtt /etc/vtt/env
  chmod 0640 /etc/vtt/env
else
  echo "[setup-host] /etc/vtt/env already exists, leaving as is"
fi

# 4. systemd unit
install -m 0644 "$REPO_ROOT/infra/systemd/vtt.service" /etc/systemd/system/vtt.service
systemctl daemon-reload
echo "[setup-host] installed /etc/systemd/system/vtt.service"
echo "[setup-host]   start with:  sudo systemctl enable --now vtt"

# 5. nginx site config (do not enable yet — operator must edit subdomain first)
install -m 0644 "$REPO_ROOT/infra/nginx/vtt.conf" /etc/nginx/sites-available/vtt.conf
echo "[setup-host] installed /etc/nginx/sites-available/vtt.conf"
echo "[setup-host]   edit it to set your real subdomain, then:"
echo "[setup-host]     sudo ln -sf /etc/nginx/sites-available/vtt.conf /etc/nginx/sites-enabled/"
echo "[setup-host]     sudo certbot --nginx -d <your-subdomain>"
echo "[setup-host]     sudo nginx -t && sudo systemctl reload nginx"

echo "[setup-host] done"
