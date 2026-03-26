#!/bin/bash

set -euo pipefail

INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_BASE="precacher"

echo "======================================================="
echo "  BOY & A SCANNER PRE-CACHER SETUP"
echo "  Install dir: $INSTALL_DIR"
echo "======================================================="

if ! command -v node >/dev/null 2>&1 || [[ $(node -v | cut -d'.' -f1 | tr -d 'v') -lt 20 ]]; then
  echo
  echo "> Installing Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo "> Node.js $(node -v) already installed"
fi

if ! command -v git >/dev/null 2>&1; then
  echo "> Installing git..."
  sudo apt-get install -y git
else
  echo "> git $(git --version | awk '{print $3}') already installed"
fi

echo
echo "> Installing npm dependencies..."
cd "$INSTALL_DIR"
npm install --production

if [[ ! -f "$INSTALL_DIR/.env" ]]; then
  echo
  echo "> Creating .env from template..."
  cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
  cat <<MSG

IMPORTANT: edit $INSTALL_DIR/.env before rerunning this script.

Required values:
  AI_PROVIDER=gemini | openrouter
  GEMINI_API_KEY=...            if using Gemini
  OPENROUTER_API_KEY=...        if using OpenRouter
  SUPABASE_URL=...
  SUPABASE_ANON_KEY=...
  AI_MODEL=...                  optional custom model id
  APP_BASE_URL=https://app.boyandascanner.com
  RR_REFRESH_ENABLED=1          optional, hot ZIPs only
  RR_USERNAME=...
  RR_PASSWORD=...

Optional SEO publishing values:
  GITHUB_TOKEN=...
  GITHUB_REPO=youruser/scanner-pages
  SEO_SITE_URL=https://www.yoursite.com

Run:
  nano $INSTALL_DIR/.env

MSG
  exit 0
fi

set -a
source "$INSTALL_DIR/.env"
set +a

AI_PROVIDER="${AI_PROVIDER:-gemini}"
CACHE_ON_CALENDAR="${CACHE_ON_CALENDAR:-Mon *-*-* 08:00:00}"
SEO_ON_CALENDAR="${SEO_ON_CALENDAR:-Mon *-*-* 08:30:00}"

case "$AI_PROVIDER" in
  openrouter)
    if [[ -z "${OPENROUTER_API_KEY:-}" || "${OPENROUTER_API_KEY:-}" == "your_openrouter_api_key_here" ]]; then
      echo
      echo "ERROR: OPENROUTER_API_KEY is required when AI_PROVIDER=openrouter."
      echo "Edit: $INSTALL_DIR/.env"
      exit 1
    fi
    ;;
  gemini)
    if [[ -z "${GEMINI_API_KEY:-}" || "${GEMINI_API_KEY:-}" == "your_gemini_api_key_here" ]]; then
      echo
      echo "ERROR: GEMINI_API_KEY is required when AI_PROVIDER=gemini."
      echo "Edit: $INSTALL_DIR/.env"
      exit 1
    fi
    ;;
  *)
    echo
    echo "ERROR: AI_PROVIDER must be 'gemini' or 'openrouter'."
    echo "Current value: $AI_PROVIDER"
    exit 1
    ;;
esac

if [[ -z "${SUPABASE_URL:-}" || -z "${SUPABASE_ANON_KEY:-}" ]]; then
  echo
  echo "ERROR: SUPABASE_URL and SUPABASE_ANON_KEY are required."
  echo "Edit: $INSTALL_DIR/.env"
  exit 1
fi

echo "> .env found with required credentials"

if [[ -z "${GITHUB_TOKEN:-}" || "${GITHUB_TOKEN:-}" == "your_github_token_here" ]]; then
  cat <<MSG

INFO: GITHUB_TOKEN not set. SEO publishing will be skipped until you add:
  GITHUB_TOKEN=ghp_...
  GITHUB_REPO=youruser/scanner-seo-pages
  SEO_SITE_URL=https://www.boyandascanner.com

MSG
fi

echo
echo "> Creating systemd services..."

sudo tee /etc/systemd/system/${SERVICE_BASE}-cache.service > /dev/null <<EOF
[Unit]
Description=Boy and a Scanner Cache Warmer
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/node ${INSTALL_DIR}/precacher.mjs --cache-only
EnvironmentFile=${INSTALL_DIR}/.env
User=$(whoami)
StandardOutput=journal
StandardError=journal
TimeoutStartSec=7200

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/${SERVICE_BASE}-seo.service > /dev/null <<EOF
[Unit]
Description=Boy and a Scanner SEO Publisher
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/node ${INSTALL_DIR}/precacher.mjs --seo-only
EnvironmentFile=${INSTALL_DIR}/.env
User=$(whoami)
StandardOutput=journal
StandardError=journal
TimeoutStartSec=7200

[Install]
WantedBy=multi-user.target
EOF

echo "> Creating systemd timers..."

sudo tee /etc/systemd/system/${SERVICE_BASE}-cache.timer > /dev/null <<EOF
[Unit]
Description=Run Boy and a Scanner cache warmer weekly

[Timer]
OnCalendar=${CACHE_ON_CALENDAR}
Persistent=true
RandomizedDelaySec=600

[Install]
WantedBy=timers.target
EOF

sudo tee /etc/systemd/system/${SERVICE_BASE}-seo.timer > /dev/null <<EOF
[Unit]
Description=Run Boy and a Scanner SEO publisher weekly

[Timer]
OnCalendar=${SEO_ON_CALENDAR}
Persistent=true
RandomizedDelaySec=600

[Install]
WantedBy=timers.target
EOF

echo "> Enabling systemd timers..."
sudo systemctl daemon-reload
sudo systemctl disable --now ${SERVICE_BASE}.timer 2>/dev/null || true
sudo systemctl enable ${SERVICE_BASE}-cache.timer
sudo systemctl enable ${SERVICE_BASE}-seo.timer

cat <<MSG

=======================================================
SETUP COMPLETE

Commands:
  Start cache timer:   sudo systemctl start precacher-cache.timer
  Start SEO timer:     sudo systemctl start precacher-seo.timer
  Run once manually:   node precacher.mjs --test
  Run cache only:      node precacher.mjs --cache-only
  Run full manually:   node precacher.mjs
  SEO only:            node precacher.mjs --seo-only
  Check timers:        systemctl status precacher-cache.timer precacher-seo.timer
  View cache logs:     journalctl -u precacher-cache.service -f
  View SEO logs:       journalctl -u precacher-seo.service -f
  Stop timers:         sudo systemctl stop precacher-cache.timer precacher-seo.timer
=======================================================

MSG
