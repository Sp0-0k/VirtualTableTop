#!/usr/bin/env bash
# Deploy VTT to EC2.
# Adapted from CS260's deployService.sh — pm2-managed, runs as `ubuntu`,
# lives at ~/services/vtt/.
#
# Usage:
#   bash infra/scripts/deploy.sh -k <pem key> -h <hostname> [-s <service>]
#
# Service name defaults to `vtt`. Hostname is the public DNS / subdomain.

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
cp package.json package-lock.json build/

echo "----> Clearing remote target"
ssh -i "$key" ubuntu@"$hostname" "rm -rf services/$service && mkdir -p services/$service"

echo "----> Copying to remote"
scp -r -i "$key" build/* ubuntu@"$hostname":services/"$service"

echo "----> Installing deps and (re)starting pm2 process"
ssh -i "$key" ubuntu@"$hostname" << ENDSSH
bash -i
cd services/$service
npm ci --omit=dev
if pm2 describe $service >/dev/null 2>&1; then
    pm2 restart $service
else
    pm2 start dist/server.js --name $service
fi
pm2 save
ENDSSH

rm -rf build
echo "----> Done. Verify: curl https://$hostname/api/health"
