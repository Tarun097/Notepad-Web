#!/usr/bin/env bash
set -euo pipefail

APP_NAME="Notepad+ Web"
APP_DIR="$HOME/Applications/${APP_NAME}.app"
PLIST_LABEL="notepad+Web"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"

FOUND=0

# Stop and remove daemon
if [ -f "$PLIST_PATH" ]; then
  echo "Stopping daemon..."
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
  rm -f "$PLIST_PATH"
  FOUND=1
fi

# Kill running processes
lsof -ti:3001 | xargs kill 2>/dev/null || true
lsof -ti:5173 | xargs kill 2>/dev/null || true

# Remove app bundle
if [ -d "$APP_DIR" ]; then
  rm -rf "$APP_DIR"
  FOUND=1
fi

if [ "$FOUND" -eq 0 ]; then
  echo "ℹ️  ${APP_NAME} is not installed."
else
  echo "✅ ${APP_NAME} uninstalled."
fi
