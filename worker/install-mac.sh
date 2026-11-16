#!/bin/bash
# Installs the Keenest worker as a background service on this Mac (starts on login, restarts if it stops).
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="$(command -v node)"
CLAUDE="$(command -v claude)"
[ -z "$NODE" ] && { echo "node not found"; exit 1; }
[ -z "$CLAUDE" ] && { echo "claude not found"; exit 1; }
mkdir -p "$HOME/.keenest-worker" "$HOME/Library/LaunchAgents"
PLIST="$HOME/Library/LaunchAgents/il.co.keenest.worker.plist"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>il.co.keenest.worker</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/worker.mjs</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(dirname "$NODE"):$(dirname "$CLAUDE"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string><key>HOME</key><string>$HOME</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$HOME/.keenest-worker/stdout.log</string>
  <key>StandardErrorPath</key><string>$HOME/.keenest-worker/stderr.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/il.co.keenest.worker" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Keenest worker installed and running. Log: ~/.keenest-worker/worker.log"
