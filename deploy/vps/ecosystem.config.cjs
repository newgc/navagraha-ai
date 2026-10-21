// pm2 process list for the VPS staging site, started by deploy/vps/remote-deploy.sh with
// RELEASE (the release folder to run) and NAV_HOME set. Settings come from the env.json the
// deploy workflow writes from GitHub secrets, so nobody edits files on the server.
const fs = require('node:fs');
const path = require('node:path');

const home = process.env.NAV_HOME;
const release = process.env.RELEASE;
if (!home || !release) throw new Error('NAV_HOME and RELEASE must be set');

const settings = JSON.parse(fs.readFileSync(path.join(home, 'shared', 'env.json'), 'utf8'));
const heapMb = Number(settings.NODE_HEAP_MB || 384);
const env = {
  ...settings,
  NODE_ENV: 'production',
  NO_COLOR: '1',
  NEXT_TELEMETRY_DISABLED: '1',
  API_HOST: '127.0.0.1',
  API_URL: `http://127.0.0.1:${settings.API_PORT}`,
};
const common = {
  interpreter: path.join(home, 'runtime', 'current', 'bin', 'node'),
  node_args: [`--max-old-space-size=${heapMb}`],
  // The server is shared with InstaLeads: restart a process that grows past its share
  // instead of letting it squeeze the other site.
  max_memory_restart: `${heapMb + 192}M`,
  autorestart: true,
  max_restarts: 10,
  min_uptime: 10000,
  time: true,
  merge_logs: true,
};

module.exports = {
  apps: [
    {
      ...common,
      name: 'navagraha-api',
      cwd: release,
      script: 'apps/api/dist/main.js',
      out_file: path.join(home, 'logs', 'api.log'),
      error_file: path.join(home, 'logs', 'api.log'),
      env,
    },
    {
      ...common,
      name: 'navagraha-web',
      cwd: path.join(release, 'apps', 'web'),
      script: 'node_modules/next/dist/bin/next',
      // Loopback only: nginx is the public entrance and adds HTTPS.
      args: ['start', '-H', '127.0.0.1', '-p', String(settings.WEB_PORT)],
      out_file: path.join(home, 'logs', 'web.log'),
      error_file: path.join(home, 'logs', 'web.log'),
      env,
    },
  ],
};
