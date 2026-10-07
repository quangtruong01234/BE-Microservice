#!/bin/bash
# ================================
# 🏗️ Start Node B (Inventory + Payments + Rewards + Assistant)
# ================================

# Navigate to API directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$API_DIR"

echo "📂 Working directory: $(pwd)"

# Load environment variables
if [ -f "local/nodeB/.env" ]; then
  export $(grep -v '^#' local/nodeB/.env | xargs)
  echo "✅ Environment loaded from local/nodeB/.env"
else
  echo "⚠️  No .env found in local/nodeB/.env"
fi

# Ensure Node.js modules installed
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm install
fi

# Start microservices using npm scripts
echo "🚀 Starting Node B services (Inventory + Payments + Rewards + Assistant)..."
npm run start:nodeB
