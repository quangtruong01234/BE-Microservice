#!/bin/bash
# Production startup script for Node B (EC2 #2)
# Services: Inventory, Payments, Rewards

echo "🚀 Starting Node B services in production..."

# Set production environment
export NODE_ENV=production

# Start services with PM2 for process management
pm2 start dist/apps/inventory/main.js --name "inventory" --instances 1
pm2 start dist/apps/payments/main.js --name "payments" --instances 1
pm2 start dist/apps/rewards/main.js --name "rewards" --instances 1

# Show PM2 status
pm2 list

echo "✅ Node B services started successfully!"
echo "Inventory: Available on configured port"
echo "Payments: Available on configured port"
echo "Rewards: Available on configured port"