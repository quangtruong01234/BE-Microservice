# TryBuy VPS First Deploy Runbook

This runbook targets the first manual production deploy on a single Ubuntu VPS.
It intentionally does not add GitHub Actions deploy, GHCR publishing, Aiven
connectivity checks, or database migrations.

## Runtime Model

- Host PM2 runs compiled NestJS services from `dist/apps/<service>/main.js`.
- Docker Compose runs infrastructure only: Redis and RabbitMQ.
- MySQL and PostgreSQL are external managed databases. Do not run DB containers
  for this deployment model.
- Nginx and Certbot run on the host and proxy public traffic to the gateway.
- Public traffic enters through Nginx on `80`/`443`; NestJS, Redis, RabbitMQ,
  and RabbitMQ management bind to localhost only.
- Migrations are a separate release operation and are not part of this first
  deploy runbook.

## 1. Ubuntu Package Install

Run as a sudo-capable deploy user on Ubuntu 22.04/24.04/26.04.

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg git nginx ufw snapd
```

Install Node.js 22 from NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x -o nodesource_setup.sh
sudo -E bash nodesource_setup.sh
sudo apt install -y nodejs
node -v
npm -v
```

Install Docker Engine and the Compose plugin from Docker's apt repository:

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
docker --version
docker compose version
```

Optional: allow the deploy user to run Docker without `sudo`.

```bash
sudo usermod -aG docker "$USER"
newgrp docker
```

Install PM2 globally:

```bash
sudo npm install -g pm2
pm2 -v
```

Install Certbot with snap:

```bash
sudo snap install core
sudo snap refresh core
sudo snap install --classic certbot
sudo ln -sf /snap/bin/certbot /usr/local/bin/certbot
certbot --version
```

## 2. Firewall And Security Group Checklist

Provider security group:

- Allow inbound SSH `22/tcp` only from trusted admin IPs.
- Allow inbound HTTP `80/tcp` from `0.0.0.0/0` and `::/0`.
- Allow inbound HTTPS `443/tcp` from `0.0.0.0/0` and `::/0`.
- Deny public inbound access to `3000-3012`, `6379`, `5672`, and `15672`.
- Add outbound egress needed for package installs, Git, npm, Docker pulls, and
  payment/shipping provider callbacks.

Host firewall:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status verbose
```

Local binding checks after deploy:

```bash
ss -ltnp | grep -E ':(3000|3001|3002|3003|3004|3005|3006|3008|3009|3012|6379|5672|15672)\b'
```

Expected: Redis and RabbitMQ ports are bound to `127.0.0.1`; gateway should be
reached publicly only through Nginx.

## 3. App Directory Setup

Create a deploy directory owned by the deploy user:

```bash
sudo mkdir -p /var/www/trybuy-api
sudo chown -R "$USER":"$USER" /var/www/trybuy-api
cd /var/www/trybuy-api
```

Clone the repository:

```bash
git clone <repo-url> .
git checkout main
```

Install dependencies and create runtime directories:

```bash
npm ci
mkdir -p logs local/nodeA local/nodeB
```

Confirm production process and Compose config syntax:

```bash
node -c ecosystem.config.js
```

## 4. Production Env File Checklist

Create the root Compose env file:

```bash
cp .env.example .env
chmod 600 .env
```

Create the PM2 app env files. Prefer the production templates, which are
pre-set with production-safe defaults (`NODE_ENV=production`,
`TYPEORM_SYNCHRONIZE=false`, `AUTH_COOKIE_SECURE=true`, `SWAGGER_ENABLED=false`,
`GHN_DEMO_ENDPOINTS_ENABLED=false`) and mark every value
that differs from local with a `# <-- PROD` comment. Fill each `CHANGE_ME_*`
placeholder with the real value:

```bash
cp local/nodeA/.env.production.example local/nodeA/.env
cp local/nodeB/.env.production.example local/nodeB/.env
chmod 600 local/nodeA/.env local/nodeB/.env
```

Note: `local/nodeB/.env.production.example` includes `NODE_ENV=production`,
which the plain `local/nodeB/.env.example` omits — without it the PostgreSQL
services (inventory/payments/rewards) keep TypeORM `synchronize` enabled in
production. The plain `local/nodeA/.env.example` / `local/nodeB/.env.example`
files remain the full variable reference; the `.env.production.example`
templates are the ready-to-copy production starting point.

Checklist for `.env`, `local/nodeA/.env`, and `local/nodeB/.env`:

- `NODE_ENV=production`
- `TYPEORM_SYNCHRONIZE=false`
- `TYPEORM_SYNCHRONIZE_ALLOW_PRODUCTION=false`
- `GHN_DEMO_ENDPOINTS_ENABLED=false`
- `GATEWAY_PORT=3000`
- `FRONTEND_URL` contains only exact production storefront and GHN console
  origins.
- `AUTH_COOKIE_SECURE=true` and `AUTH_COOKIE_SAME_SITE=lax`, unless the frontend
  is on a different site and needs `AUTH_COOKIE_SAME_SITE=none`.
- `JWT_SECRET` is a long random secret and matches every process that needs it.
- `REDIS_HOST=127.0.0.1`, `REDIS_PORT=6379`, and optional `REDIS_PASSWORD`.
- `RABBITMQ_HOST=127.0.0.1`, `RABBITMQ_PORT=5672`,
  `RABBITMQ_VHOST=rabbit-trybuy`, plus matching `RABBITMQ_USER`,
  `RABBITMQ_PASS`, and `RMQ_URL`.
- `.env` and both node env files use the same RabbitMQ credentials.
- Node A has production MySQL values. Record them, but do not test-connect here.
- Node B has production PostgreSQL values. Record them, but do not test-connect
  here.
- Cloudinary values are present on Node A.
- GHN API URL, token, shop ID, and webhook secret are present on Node A.
- ZaloPay and VNPay secrets and public callback/return URLs are present on
  Node B.
- `SWAGGER_ENABLED=false` unless production Swagger is intentionally exposed.
- No plaintext secrets are committed or copied into shared docs.

Generate strong local service secrets:

```bash
openssl rand -base64 48
```

Do not run `npm run db:migrate:*` during this first deploy pass.

## 5. First Manual Deploy Commands

Run from `/var/www/trybuy-api` after env files are filled:

```bash
docker compose config
docker compose up -d redis rabbitmq
docker compose ps
npm run deploy:check
mkdir -p logs
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
npm run pm2:start
pm2 status
```

`npm run deploy:check` runs `node -c ecosystem.config.js`, `npx tsc --noEmit`,
and `npm run build`. It does not run migrations.

If deploying split hosts later, start only the services assigned to that host:

```bash
pm2 start ecosystem.config.js --env production --only "gateway,orders,user,product,social,notification,chat"
pm2 start ecosystem.config.js --env production --only "inventory,payments,rewards"
```

## 6. PM2 Startup And Save

After PM2 shows the desired process list:

```bash
pm2 startup
```

Copy and run the exact `sudo env PATH=... pm2 startup systemd ...` command PM2
prints. Then persist the current process list:

```bash
pm2 save
systemctl status "pm2-$USER"
```

Useful runtime commands:

```bash
pm2 status
pm2 logs --lines 100
pm2 restart ecosystem.config.js --env production
pm2 save
```

After upgrading Node.js later, rerun `pm2 startup`, run the printed command, and
then `pm2 save`.

## 7. Nginx Enable, Test, And Reload

First create a temporary HTTP-only site so `nginx -t` can pass before Let's
Encrypt certificates exist:

```bash
sudo tee /etc/nginx/sites-available/trybuy >/dev/null <<'EOF'
server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
sudo ln -sf /etc/nginx/sites-available/trybuy /etc/nginx/sites-enabled/trybuy
sudo nginx -t
sudo systemctl reload nginx
```

Issue the first certificate:

```bash
sudo certbot --nginx -d api.example.com
```

Then install the repo TLS template with the real domain:

```bash
cp nginx/trybuy.conf nginx/trybuy.prod.conf
sed -i 's/yourdomain.com/api.example.com/g' nginx/trybuy.prod.conf
sudo cp nginx/trybuy.prod.conf /etc/nginx/sites-available/trybuy
sudo nginx -t
sudo systemctl reload nginx
```

The current `nginx/trybuy.conf` proxies `/`, `/socket.io/`,
`/zalopay/callback`, and `/vnpay/callback` to the gateway on
`127.0.0.1:3000`.

## 8. Health Check Commands

Local gateway checks:

```bash
curl -fsS http://127.0.0.1:3000/live
curl -fsS http://127.0.0.1:3000/ready
curl -fsS http://127.0.0.1:3000/health
```

Public Nginx checks:

```bash
curl -fsS https://api.example.com/live
curl -fsS https://api.example.com/ready
curl -fsS https://api.example.com/health
```

Expected:

- `/live` returns HTTP 200 with `status:"ok"` if the gateway process is up.
- `/ready` returns HTTP 200 only when required checked dependencies are usable.
  Redis is required; RabbitMQ and databases are currently surfaced as
  `not_checked`/`not_configured` from the gateway health module.
- `/health` returns HTTP 200 for `ok` or `degraded`, and HTTP 503 for `error`.

Infrastructure checks:

```bash
docker compose ps
docker compose logs --tail=100 redis
docker compose logs --tail=100 rabbitmq
pm2 status
pm2 logs gateway --lines 100
```

## 9. Rollback Notes

Manual rollback is source-based for this first deploy:

```bash
cd /var/www/trybuy-api
git fetch --all --prune
git checkout <known-good-commit>
npm ci
npm run deploy:check
pm2 restart ecosystem.config.js --env production
pm2 save
```

Rollback constraints:

- This runbook does not run migrations. If a future release includes migrations,
  prepare a separate DB rollback plan before deploy.
- Keep the previous `local/nodeA/.env`, `local/nodeB/.env`, and `.env` values
  backed up outside Git before changing secrets.
- If the rollback changes RabbitMQ credentials, update `.env`, both node env
  files, and restart Compose plus PM2 together.
- If the app fails before Nginx changes, leave Nginx unchanged and rollback PM2.
- If Nginx fails, restore `/etc/nginx/sites-available/trybuy` from the previous
  copy, run `sudo nginx -t`, then reload.

## 10. GitHub Actions CD Secrets Needed Later

When CD is added later, it will likely need these repository or environment
secrets. Do not add Actions or GHCR in this runbook.

- `VPS_HOST`
- `VPS_PORT`
- `VPS_USER`
- `VPS_SSH_PRIVATE_KEY`
- `VPS_APP_DIR`
- `VPS_DEPLOY_REF` or release tag input
- `NODE_ENV`
- `JWT_SECRET`
- `FRONTEND_URL`
- `AUTH_COOKIE_SAME_SITE`
- `AUTH_COOKIE_SECURE`
- `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`
- `PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_USERNAME`, `PG_PASSWORD`
- `REDIS_PASSWORD` if Redis auth is enabled
- `RABBITMQ_USER`, `RABBITMQ_PASS`, `RABBITMQ_VHOST`, `RMQ_URL`
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
- `GHN_API_URL`, `GHN_API_TOKEN`, `GHN_SHOP_ID`, `GHN_WEBHOOK_SECRET`
- `ZALOPAY_APP_ID`, `ZALOPAY_KEY1`, `ZALOPAY_KEY2`, `ZALOPAY_ENDPOINT`,
  `ZALOPAY_REDIRECT_URL`
- `VNP_TMN_CODE`, `VNP_HASH_SECRET`, `VNP_URL`, `VNP_RETURN_URL`,
  `VNPAY_IPN_URL`
- Optional deploy notification webhook if desired later.

## References

- Docker Engine for Ubuntu:
  https://docs.docker.com/engine/install/ubuntu/
- NodeSource Node.js 22 packages:
  https://github.com/nodesource/distributions/blob/master/DEV_README.md
- Certbot Nginx snap instructions:
  https://certbot.eff.org/instructions?ws=nginx&os=snap
- PM2 startup persistence:
  https://pm2.keymetrics.io/docs/usage/startup/
