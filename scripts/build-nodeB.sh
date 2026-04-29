#!/bin/bash
# Build script for Node B (EC2 #2)
# Services: Inventory, Payments, Rewards

echo "🏗️  Building Node B services..."

# Build all services for Node B
echo "Building Inventory..."
nest build inventory

echo "Building Payments..."
nest build payments

echo "Building Rewards..."
nest build rewards

# Build shared libraries
echo "Building shared libraries..."
nest build cached
nest build common
nest build database

echo "✅ Node B build completed!"
echo "Services ready: Inventory, Payments, Rewards"