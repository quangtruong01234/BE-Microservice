#!/bin/bash
# Production startup script for Node A (EC2 #1)
# Services: Gateway, Orders, User, Product

echo "🚀 Starting Node A services in production..."

# Set production environment
export NODE_ENV=production

# Start services with PM2 for process management
pm2 start dist/apps/gateway/main.js --name "gateway" --instances 1
pm2 start dist/apps/orders/main.js --name "orders" --instances 1  
pm2 start dist/apps/user/main.js --name "user" --instances 1
pm2 start dist/apps/product/main.js --name "product" --instances 1

# Show PM2 status
pm2 list

echo "✅ Node A services started successfully!"
echo "Gateway: Available on configured port"
echo "Orders: Available on configured port" 
echo "User: Available on configured port"
echo "Product: Available on configured port"