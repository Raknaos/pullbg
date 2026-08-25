#!/usr/bin/env bash
# PullBG production install — Ubuntu 22.04/24.04 on a Contabo Cloud VPS 4 (8 GB).
# Run as root:  bash install.sh
set -euo pipefail

APP_DIR=/opt/pullbg
JOBS_DIR=/var/lib/pullbg/jobs
RUN_USER=pullbg
DOMAIN="${PULLBG_DOMAIN:-pullbg.com}"

echo "==> System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg python3 python3-venv python3-pip nginx ufw build-essential

echo "==> Node.js 20 LTS"
if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs
fi
node -v

echo "==> App user + dirs"
id -u "$RUN_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$RUN_USER"
mkdir -p "$APP_DIR" "$JOBS_DIR"
chown -R "$RUN_USER:$RUN_USER" "$APP_DIR" "$JOBS_DIR"

echo "==> Copy app"
mkdir -p "$APP_DIR/server"
cp -r ../lib "$APP_DIR/lib"
cp server/package.json server/app.mjs server/worker.mjs "$APP_DIR/server/"
cp aiworker.py "$APP_DIR/"
chown -R "$RUN_USER:$RUN_USER" "$APP_DIR"

echo "==> Python venv + rembg"
if [ ! -d "$APP_DIR/venv" ]; then
  python3 -m venv "$APP_DIR/venv"
fi
"$APP_DIR/venv/bin/pip" install -q --upgrade pip
"$APP_DIR/venv/bin/pip" install -q flask rembg onnxruntime
"$APP_DIR/venv/bin/python" - <<'PY'
from rembg import new_session
print("warm model...")
new_session("isnet-general-use")   # downloads once (~170 MB)
print("model ready")
PY

echo "==> Node deps"
cd "$APP_DIR/server"
npm install --omit=dev --no-fund --no-audit

echo "==> systemd units"
cat >/etc/systemd/system/pullbg-ai.service <<UNIT
[Unit]
Description=PullBG AI (rembg)
After=network.target

[Service]
User=$RUN_USER
WorkingDirectory=$APP_DIR
Environment=PULLBG_AI_PORT=8155
ExecStart=$APP_DIR/venv/bin/python $APP_DIR/aiworker.py
Restart=always
RestartSec=5
MemoryMax=4G

[Install]
WantedBy=multi-user.target
UNIT

cat >/etc/systemd/system/pullbg-api.service <<UNIT
[Unit]
Description=PullBG API
After=network.target pullbg-ai.service
Requires=pullbg-ai.service

[Service]
User=$RUN_USER
WorkingDirectory=$APP_DIR/server
Environment=PORT=8080
Environment=PULLBG_JOBS_DIR=$JOBS_DIR
Environment=PULLBG_AI_URL=http://127.0.0.1:8155
Environment=PULLBG_DATA_DIR=/var/lib/pullbg
Environment=PULLBG_PUBLIC_URL=https://cutbg.studio
EnvironmentFile=-/etc/pullbg/env
ExecStart=/usr/bin/node app.mjs
Restart=always
RestartSec=3
MemoryMax=3G

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now pullbg-ai.service
systemctl enable --now pullbg-api.service

echo "==> Firewall (keep SSH)"
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable

echo "==> nginx reverse proxy"
cat >/etc/nginx/sites-available/pullbg <<NGX
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;

    client_max_body_size 30m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 180s;
    }
}
NGX
ln -sf /etc/nginx/sites-available/pullbg /etc/nginx/sites-enabled/pullbg
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl restart nginx

echo
echo "==> DONE =="
echo "API:  systemctl status pullbg-api"
echo "AI:   systemctl status pullbg-ai"
echo "Test: curl http://127.0.0.1:8080/api/health"
echo "Then point the domain A record to this server's IP and issue TLS:"
echo "  apt-get install -y certbot python3-certbot-nginx"
echo "  certbot --nginx -d $DOMAIN -d www.$DOMAIN"