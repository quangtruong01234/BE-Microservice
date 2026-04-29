#!/bin/bash
# Build script for Node A (EC2 #1)
# Services: Gateway, Orders, User, Product

echo "🏗️  Building Node A services..."

# Build all services for Node A
echo "Building Gateway..."
nest build gateway

echo "Building Orders..."
nest build orders

echo "Building User..."
nest build user

echo "Building Product..."
nest build product

# Build shared libraries
echo "Building shared libraries..."
nest build cached
nest build common
nest build database

echo "✅ Node A build completed!"
echo "Services ready: Gateway, Orders, User, Product"