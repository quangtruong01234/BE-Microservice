#!/bin/bash

# Script để tạo dữ liệu mẫu cho inventory
# Chạy sau khi đã có dữ liệu product

echo "🚀 Creating sample inventory data..."

# URL của inventory service (thông qua gateway)
BASE_URL="http://localhost:3000"

# Tạo inventory cho các product có sẵn
echo "📦 Creating inventory records..."

# Inventory cho product ID 1
curl -X POST "$BASE_URL/inventory" \
  -H "Content-Type: application/json" \
  -d '{
    "productId": 1,
    "sku": "IPHONE15-BK-128",
    "availableStock": 50,
    "minimumStock": 10,
    "location": "WAREHOUSE-A1"
  }' | jq '.'

# Inventory cho product ID 2  
curl -X POST "$BASE_URL/inventory" \
  -H "Content-Type: application/json" \
  -d '{
    "productId": 2,
    "sku": "GALAXY-S24-WH-256",
    "availableStock": 30,
    "minimumStock": 5,
    "location": "WAREHOUSE-A2"
  }' | jq '.'

# Inventory cho product ID 3
curl -X POST "$BASE_URL/inventory" \
  -H "Content-Type: application/json" \
  -d '{
    "productId": 3,
    "sku": "MACBOOK-PRO-16-512",
    "availableStock": 15,
    "minimumStock": 3,
    "location": "WAREHOUSE-B1"
  }' | jq '.'

# Inventory cho product ID 4
curl -X POST "$BASE_URL/inventory" \
  -H "Content-Type: application/json" \
  -d '{
    "productId": 4,
    "sku": "DELL-XPS13-512",
    "availableStock": 8,
    "minimumStock": 2,
    "location": "WAREHOUSE-B2"
  }' | jq '.'

# Inventory cho product ID 5
curl -X POST "$BASE_URL/inventory" \
  -H "Content-Type: application/json" \
  -d '{
    "productId": 5,
    "sku": "AIRPODS-PRO-2",
    "availableStock": 100,
    "minimumStock": 20,
    "location": "WAREHOUSE-C1"
  }' | jq '.'

echo "✅ Inventory data created successfully!"
echo ""
echo "🔍 Testing aggregator API..."
echo ""

# Test aggregator API - Get product with inventory
echo "📊 Testing product with inventory API:"
curl -X GET "$BASE_URL/products/1/with-inventory" | jq '.'

echo ""
echo "📊 Testing multiple products with inventory API:"
curl -X POST "$BASE_URL/products/with-inventory/multiple" \
  -H "Content-Type: application/json" \
  -d '{
    "productIds": [1, 2, 3]
  }' | jq '.'

echo ""
echo "📊 Testing stock check API:"
curl -X GET "$BASE_URL/products/1/stock-check?quantity=5" | jq '.'

echo ""
echo "✅ All tests completed!"