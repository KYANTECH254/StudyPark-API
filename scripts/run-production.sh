#!/usr/bin/env bash
set -euo pipefail

APP_NAME="studypark-server"
PORT="3055"
NODE_ENV="production"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${API_DIR}"
export NODE_ENV
export PORT="${PORT}"

if [ -f "${API_DIR}/.env" ]; then
  echo "[prod] Loading .env file"
  set -a
  source "${API_DIR}/.env"
  set +a
fi

export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
fi

echo "========================================"
echo "[prod] Deploy started at $(date)"
echo "[prod] App dir: ${API_DIR}"
echo "[prod] DATABASE_URL: ${DATABASE_URL:0:20}..."
echo "[prod] PORT: ${PORT}"
echo "========================================"

echo "[prod] Installing dependencies"
if [ -f package-lock.json ]; then
  npm ci --omit=dev || npm install --omit=dev
else
  npm install --omit=dev || npm install
fi

echo "[prod] Generating Prisma client"
npx prisma generate

echo "[prod] Deduplicating engagement rows"
node scripts/dedupe-engagement.js

echo "[prod] Applying database schema"
npx prisma db push --accept-data-loss

if [ -f "${API_DIR}/seed.js" ]; then
  echo "[prod] Seeding system services"
  node seed.js
fi

if pm2 list | grep -q "${APP_NAME}"; then
  echo "[prod] Restarting PM2 app: ${APP_NAME}"
  pm2 restart "${APP_NAME}" --update-env
else
  echo "[prod] Starting PM2 app: ${APP_NAME}"
  pm2 start server.js --name "${APP_NAME}" --time
fi

echo "[prod] Saving PM2 process list"
pm2 save

echo "[prod] PM2 status"
pm2 status "${APP_NAME}"

echo "========================================"
echo "[prod] Deploy completed successfully at $(date)"
echo "========================================"
