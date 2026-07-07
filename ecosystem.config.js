// PM2 production process file — TryBuy backend.
//
// One PM2 app per microservice, each running the COMPILED bundle
// (`dist/apps/<svc>/main.js`) produced by `npm run build`. PM2 supervises every
// service process directly, so a single crashed service is restarted on its own
// (the old setup ran `npm run start:nodeA|B` → `concurrently` of `nest --watch`,
// where PM2 only watched the wrapper and a runtime crash went unrestarted).
//
// Build first:   npm run build
// Start all:     pm2 start ecosystem.config.js --env production
// Start one node (pass the machine's service names to --only, comma-separated):
//   Node A: pm2 start ecosystem.config.js --env production \
//             --only "gateway,orders,user,product,social,notification,chat"
//   Node B: pm2 start ecosystem.config.js --env production \
//             --only "inventory,payments,rewards"
// Persist across reboots: pm2 startup, run the printed command, then pm2 save
//
// `cwd` is the api root (where this file lives), so each service's
// `dotenv.config({ path: "./local/node{A,B}/.env" })` resolves correctly.

const logDir = './logs';

const defaults = {
  cwd: __dirname,
  instances: 1,
  exec_mode: 'fork',
  autorestart: true,
  watch: false,
  max_memory_restart: '500M',
  min_uptime: '10s',
  max_restarts: 10,
  restart_delay: 5000,
  kill_timeout: 10000,
  time: true,
  merge_logs: false,
  env_production: { NODE_ENV: 'production' },
};

const service = (name) => ({
  ...defaults,
  name,
  script: `dist/apps/${name}/main.js`,
  out_file: `${logDir}/${name}.out.log`,
  error_file: `${logDir}/${name}.error.log`,
});

module.exports = {
  apps: [
    // Node A
    service('gateway'),
    service('orders'),
    service('user'),
    service('product'),
    service('social'),
    service('notification'),
    service('chat'),
    // Node B
    service('inventory'),
    service('payments'),
    service('rewards'),
  ],
};
