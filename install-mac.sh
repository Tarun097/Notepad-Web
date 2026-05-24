#!/usr/bin/env bash
set -euo pipefail

# Installs Notepad+ Web as a macOS app with a background daemon (LaunchAgent)
# that starts automatically on login. The app just opens the browser.

APP_NAME="Notepad+ Web"
APP_DIR="$HOME/Applications/${APP_NAME}.app"
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
ICON_SRC="$REPO_DIR/public/favicon.svg"
PLIST_LABEL="notepad+Web"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"

echo "Installing ${APP_NAME}..."

# Check prerequisites
if ! command -v node &>/dev/null || ! command -v npm &>/dev/null; then
  echo "⚠️  Node.js and npm are required but not installed."
  if command -v brew &>/dev/null; then
    echo "   Installing Node.js via Homebrew..."
    brew install node
  else
    echo "❌ Please install Node.js from https://nodejs.org or install Homebrew first:"
    echo "   /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
    exit 1
  fi
fi

# Ensure dependencies
cd "$REPO_DIR"
if [ ! -d node_modules ]; then
  echo "Installing npm dependencies..."
  npm install
fi

# --- Create LaunchAgent (daemon) ---
echo "Creating LaunchAgent daemon..."
mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST_PATH" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${REPO_DIR}/notepad+Web</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>${REPO_DIR}</string>
    <key>StandardOutPath</key>
    <string>${HOME}/Library/Logs/notepad-plus-web.log</string>
    <key>StandardErrorPath</key>
    <string>${HOME}/Library/Logs/notepad-plus-web.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>
PLIST

# --- Create serve.sh (what the daemon runs) ---
cat > "$REPO_DIR/notepad+Web" << 'SERVE'
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

# Set JAVA17_HOME for Groovy support
if [ -z "${JAVA17_HOME:-}" ]; then
  if [ -d "/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home" ]; then
    export JAVA17_HOME="/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home"
  fi
fi

# Kill any existing processes on our ports
lsof -ti:3001 | xargs kill 2>/dev/null || true
lsof -ti:5173 | xargs kill 2>/dev/null || true

# Start runner server
node server/runner.mjs &
RUNNER_PID=$!

# Start vite
npx vite --port 5173 &
VITE_PID=$!

cleanup() {
  kill $RUNNER_PID 2>/dev/null || true
  kill $VITE_PID 2>/dev/null || true
}
trap cleanup EXIT

wait $VITE_PID $RUNNER_PID 2>/dev/null || true
SERVE
chmod +x "$REPO_DIR/notepad+Web"

# --- Create .app bundle (just opens browser) ---
echo "Creating app bundle..."
mkdir -p "${APP_DIR}/Contents/MacOS"
mkdir -p "${APP_DIR}/Contents/Resources"

cat > "${APP_DIR}/Contents/MacOS/launch" << 'LAUNCHER'
#!/usr/bin/env bash
open "http://localhost:5173"
LAUNCHER
chmod +x "${APP_DIR}/Contents/MacOS/launch"

cat > "${APP_DIR}/Contents/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>${APP_NAME}</string>
    <key>CFBundleDisplayName</key>
    <string>${APP_NAME}</string>
    <key>CFBundleIdentifier</key>
    <string>${PLIST_LABEL}</string>
    <key>CFBundleVersion</key>
    <string>0.5.0</string>
    <key>CFBundleExecutable</key>
    <string>launch</string>
    <key>CFBundleIconFile</key>
    <string>app.icns</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>LSMinimumSystemVersion</key>
    <string>10.15</string>
</dict>
</plist>
PLIST

# --- Generate icon ---
ICON_TMP=$(mktemp -d)
qlmanage -t -s 512 -o "$ICON_TMP" "$ICON_SRC" 2>/dev/null || true
if [ -f "${ICON_TMP}/favicon.svg.png" ]; then
  ICONSET="${ICON_TMP}/app.iconset"
  mkdir -p "$ICONSET"
  cp "${ICON_TMP}/favicon.svg.png" "${ICONSET}/icon_512x512.png"
  for SIZE in 16 32 64 128 256; do
    sips -z $SIZE $SIZE "${ICON_TMP}/favicon.svg.png" --out "${ICONSET}/icon_${SIZE}x${SIZE}.png" &>/dev/null || true
  done
  iconutil -c icns "$ICONSET" -o "${APP_DIR}/Contents/Resources/app.icns" 2>/dev/null || true
fi
rm -rf "$ICON_TMP"

# --- Start the daemon now ---
echo "Starting daemon..."
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

# Register with Launch Services
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "${APP_DIR}" 2>/dev/null || true

echo ""
echo "✅ ${APP_NAME} installed!"
echo "   App: ${APP_DIR}"
echo "   Daemon: ${PLIST_PATH}"
echo "   Logs: ~/Library/Logs/notepad-plus-web.log"
echo ""
echo "   The server starts automatically on login."
echo "   Search '${APP_NAME}' in Spotlight to open the browser."
echo ""
echo "To uninstall: ./uninstall-mac.sh"
