#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/../.."
echo "Starting Assistant..."
# The service loads local/nodeB/.env itself (ConfigModule envFilePath).
npm run start:assistant
