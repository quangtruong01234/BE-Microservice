#!/bin/bash
# ================================
# 🛍️  Start Product Service
# ================================

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

# Start Product Service
echo "🛍️  Starting Product Service on TCP port 3006..."
echo "🔗 Product Service will be available at localhost:3006"
echo "📊 Connected to Gateway at localhost:3000"
echo "==============================================="

nest start product --watch