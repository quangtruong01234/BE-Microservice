#!/bin/bash
# Health check script for Node B services

echo "🏥 Checking Node B services health..."

# Check Inventory
echo "Checking Inventory (port 3004)..."
if curl -f http://localhost:3004/health > /dev/null 2>&1; then
    echo "✅ Inventory: Healthy"
else
    echo "❌ Inventory: Unhealthy"
fi

# Check Payments
echo "Checking Payments (port 3005)..."
if curl -f http://localhost:3005/health > /dev/null 2>&1; then
    echo "✅ Payments: Healthy"
else
    echo "❌ Payments: Unhealthy"
fi

# Check Rewards
echo "Checking Rewards (port 3006)..."
if curl -f http://localhost:3006/health > /dev/null 2>&1; then
    echo "✅ Rewards: Healthy"
else
    echo "❌ Rewards: Unhealthy"
fi

# Check PM2 status
echo ""
echo "📊 PM2 Process Status:"
pm2 list