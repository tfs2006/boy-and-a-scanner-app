#!/bin/bash
# ═══════════════════════════════════════════════════════════
#  Boy & A Scanner — Pre-Cacher Setup Script
#  Run this on the Oracle Cloud VM (Ubuntu 22.04)
# ═══════════════════════════════════════════════════════════

set -e

INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_NAME="precacher"

echo "═══════════════════════════════════════════════════════"
echo "  BOY & A SCANNER — PRE-CACHER SETUP"
echo "  Install dir: $INSTALL_DIR"
echo "═══════════════════════════════════════════════════════"

# ─── Step 1: Install Node.js 20 LTS ───────────────────────

if ! command -v node &> /dev/null || [[ $(node -v | cut -d'.' -f1 | tr -d 'v') -lt 20 ]]; then
  echo ""
  echo "▸ Installing Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo "▸ Node.js $(node -v) already installed ✓"
fi

# ─── Step 2: Install npm dependencies ─────────────────────

echo ""
echo "▸ Installing npm dependencies..."
cd "$INSTALL_DIR"
npm install --production

# ─── Step 3: Check .env ───────────────────────────────────

if [ ! -f "$INSTALL_DIR/.env" ]; then
  echo ""
  echo "▸ Creating .env from template..."
  cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
  echo ""
  echo "╔══════════════════════════════════════════════════════╗"
  echo "║  ⚠️  IMPORTANT: Edit .env with your credentials!    ║"
  echo "║                                                      ║"
  echo "║  nano $INSTALL_DIR/.env                              ║"
  echo "║                                                      ║"
  echo "║  Fill in:                                            ║"
  echo "║    GEMINI_API_KEY=...                                ║"
  echo "║    SUPABASE_URL=...                                  ║"
  echo "║    SUPABASE_ANON_KEY=...                             ║"
  echo "╚══════════════════════════════════════════════════════╝"
  echo ""
  echo "After editing .env, run this script again to finish setup."
  exit 0
fi

# Verify credentials exist
source "$INSTALL_DIR/.env" 2>/dev/null || true
if [[ -z "$GEMINI_API_KEY" || "$GEMINI_API_KEY" == "your_gemini_api_key_here" ]]; then
  echo ""
  echo "❌ GEMINI_API_KEY is not set in .env. Please edit it first:"
  echo "   nano $INSTALL_DIR/.env"
  exit 1
fi

echo "▸ .env found with credentials ✓"

# ─── Step 4: Create systemd service ───────────────────────

echo ""
echo "▸ Creating systemd service..."

sudo tee /etc/systemd/system/${SERVICE_NAME}.service > /dev/null <<EOF
[Unit]
Description=Boy & A Scanner Pre-Cacher
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/node ${INSTALL_DIR}/precacher.mjs
EnvironmentFile=${INSTALL_DIR}/.env
User=$(whoami)
StandardOutput=journal
StandardError=journal
TimeoutStartSec=7200

[Install]
WantedBy=multi-user.target
EOF

# ─── Step 5: Create systemd timer ─────────────────────────

echo "▸ Creating systemd timer (runs daily at 3 AM UTC)..."

sudo tee /etc/systemd/system/${SERVICE_NAME}.timer > /dev/null <<EOF
[Unit]
Description=Run Pre-Cacher daily

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true
RandomizedDelaySec=600

[Install]
WantedBy=timers.target
EOF

# ─── Step 6: Enable and start ─────────────────────────────

echo "▸ Enabling systemd timer..."
sudo systemctl daemon-reload
sudo systemctl enable ${SERVICE_NAME}.timer

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ✅ SETUP COMPLETE!"
echo ""
echo "  Commands:"
echo "    Start timer now:     sudo systemctl start precacher.timer"
echo "    Run once manually:   node precacher.mjs --test"
echo "    Run full manually:   node precacher.mjs"
echo "    Check timer status:  systemctl status precacher.timer"
echo "    View logs:           journalctl -u precacher.service -f"
echo "    Stop timer:          sudo systemctl stop precacher.timer"
echo "═══════════════════════════════════════════════════════"
