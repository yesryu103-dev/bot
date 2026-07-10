#!/usr/bin/env bash
set -euo pipefail

APP_NAME="wallet-bot"
APP_DIR="/opt/${APP_NAME}"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo bash deploy/setup-ubuntu.sh"
  exit 1
fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

apt-get update
apt-get install -y ca-certificates curl gnupg rsync

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 18 ]]; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y nodejs
fi

mkdir -p "${APP_DIR}"
rsync -a --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude bot.out.log \
  --exclude bot.err.log \
  "${SOURCE_DIR}/" "${APP_DIR}/"

cd "${APP_DIR}"
npm ci --omit=dev

if [[ ! -f "${APP_DIR}/.env" ]]; then
  cp "${APP_DIR}/.env.example" "${APP_DIR}/.env"
  chmod 600 "${APP_DIR}/.env"
  echo "Created ${APP_DIR}/.env from example. Edit it before starting real trading."
fi

cat > "${SERVICE_FILE}" <<SERVICE
[Unit]
Description=Telegram wallet trading bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable "${APP_NAME}"
systemctl restart "${APP_NAME}"

echo "Installed ${APP_NAME}."
echo "Status: sudo systemctl status ${APP_NAME}"
echo "Logs:   sudo journalctl -u ${APP_NAME} -f"
