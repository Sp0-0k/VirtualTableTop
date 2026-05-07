// pm2 config for the VTT app on EC2.
// Used by infra/scripts/deploy.sh — `pm2 startOrReload ecosystem.config.cjs`.
//
// node_args: --env-file loads .env (sibling of dist/, in /home/ubuntu/services/vtt/)
// at process start, so APP_SECRET et al. land in process.env without sourcing
// shell rc files.

module.exports = {
  apps: [
    {
      name: 'vtt',
      script: 'dist/server.js',
      node_args: '--env-file=.env',
      env: {
        NODE_ENV: 'production',
      },
      max_restarts: 10,
      restart_delay: 2000,
    },
  ],
};
