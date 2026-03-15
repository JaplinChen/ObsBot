#!/bin/bash
# Patch Telegraf polling timeout from 50s to 5s for faster bot restarts.
# Telegraf hardcodes this value; no config option exists.
POLLING_FILE="node_modules/telegraf/lib/core/network/polling.js"
if [ -f "$POLLING_FILE" ]; then
  sed -i 's/timeout: 50,/timeout: 5,/' "$POLLING_FILE"
  echo "✅ Patched Telegraf polling timeout: 50s → 5s"
fi
