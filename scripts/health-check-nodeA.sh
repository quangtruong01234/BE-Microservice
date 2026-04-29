#!/bin/bash
# Health check script for Node A services

echo "🏥 Checking Node A services health..."

# Check Gateway
echo "Checking Gateway (port 3000)..."
if curl -f http://localhost:3000/health > /dev/null 2>&1; then
    echo "✅ Gateway: Healthy"
else
    echo "❌ Gateway: Unhealthy"
fi

# Check Orders
echo "Checking Orders (port 3001)..."
if curl -f http://localhost:3001/health > /dev/null 2>&1; then
    echo "✅ Orders: Healthy"  
else
    echo "❌ Orders: Unhealthy"
fi

# Check User
echo "Checking User (port 3002)..."
if curl -f http://localhost:3002/health > /dev/null 2>&1; then
    echo "✅ User: Healthy"
else
    echo "❌ User: Unhealthy"
fi

# Check Product  
echo "Checking Product (port 3003)..."
if curl -f http://localhost:3003/health > /dev/null 2>&1; then
    echo "✅ Product: Healthy"
else
    echo "❌ Product: Unhealthy"  
fi

# Check PM2 status
echo ""
echo "📊 PM2 Process Status:"
pm2 list