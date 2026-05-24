#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  npm install
fi

# Set JAVA17_HOME for Groovy support if not already set
if [ -z "${JAVA17_HOME:-}" ]; then
  if [ -d "/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home" ]; then
    export JAVA17_HOME="/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home"
  fi
fi

# Kill any existing runner on port 3001
lsof -ti:3001 | xargs kill 2>/dev/null || true

# Start the code runner server in the background
node server/runner.mjs &
RUNNER_PID=$!
trap "kill $RUNNER_PID 2>/dev/null || true" EXIT

# Wait for runner to be ready
sleep 1

npm run dev
