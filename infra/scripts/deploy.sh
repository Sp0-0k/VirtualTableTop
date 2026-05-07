#!/usr/bin/env bash
# Deploy VTT to EC2.
# Adapted from CS260's deployService.sh — pm2-managed, runs as `ubuntu`,
# lives at ~/services/vtt/.
#
# Usage:
#   bash infra/scripts/deploy.sh -k <pem key> -h <hostname> [-s <service>]
#
# Service name defaults to `vtt`. Hostname is the public DNS / subdomain.
#
# IMPORTANT: this preserves the on-box .env and vtt.sqlite — those are
# never overwritten. First-time deploy: SSH in and create .env from
# .env.example before running this.

set -euo pipefail

service=vtt

while getopts k:h:s: flag; do
    case "${flag}" in
        k) key=${OPTARG};;
        h) hostname=${OPTARG};;
        s) service=${OPTARG};;
        *) ;;
    esac
done

if [[ -z "${key:-}" || -z "${hostname:-}" ]]; then
    echo "syntax: deploy.sh -k <pem key> -h <hostname> [-s <service>]"
    exit 1
fi

echo "----> Deploying $service to $hostname"

echo "----> Building"
npm ci
npm run build

echo "----> Staging deployment package"
rm -rf build
mkdir build
cp -r dist build/dist
cp -r public build/public
cp -r migrations build/migrations
cp ecosystem.config.cjs build/
cp package.json package-lock.json build/

echo "----> Syncing to remote (preserves .env and *.sqlite*)"
ssh -i "$key" ubuntu@"$hostname" "mkdir -p services/$service"
# rsync with --delete gives us a clean install of code while keeping
# the operator-managed .env and the live database files.
rsync -az --delete \
    --exclude='.env' \
    --exclude='*.sqlite' \
    --exclude='*.sqlite-wal' \
    --exclude='*.sqlite-shm' \
    --exclude='node_modules' \
    -e "ssh -i $key" \
    build/ ubuntu@"$hostname":services/"$service"/

echo "----> Installing deps and (re)starting pm2 process"
ssh -i "$key" ubuntu@"$hostname" << ENDSSH
bash -i
cd services/$service
if [[ ! -f .env ]]; then
    echo "ERROR: services/$service/.env is missing on the host." >&2
    echo "       Copy .env.example, fill in APP_SECRET, then re-run deploy." >&2
    exit 1
fi
npm ci --omit=dev
pm2 startOrReload ecosystem.config.cjs
pm2 save
ENDSSH

rm -rf build
echo "----> Done. Verify: curl https://$hostname/api/health"
