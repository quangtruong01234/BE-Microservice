#!/bin/bash
# ================================
# 🏗️ Start Node A (Gateway + Orders + User + Product)
# ================================

# Navigate to API directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$API_DIR"

echo "📂 Working directory: $(pwd)"

# Load environment variables
if [ -f "local/nodeA/.env" ]; then
  export $(grep -v '^#' local/nodeA/.env | xargs)
  echo "✅ Environment loaded from local/nodeA/.env"
else
  echo "⚠️  No .env found in local/nodeA/.env"
fi

# Ensure Node.js modules installed
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm install
fi

# Start Gateway + Orders + User + Product using npm scripts
echo "🚀 Starting Node A services (Gateway + Orders + User + Product)..."
npm run start:nodeA