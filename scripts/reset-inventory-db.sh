#!/bin/bash

echo "🗑️  Resetting Inventory Database..."

# Connect to PostgreSQL and drop/recreate inventory database
psql -h localhost -U postgres -c "DROP DATABASE IF EXISTS inventory;"
psql -h localhost -U postgres -c "CREATE DATABASE inventory;"

echo "✅ Inventory database has been reset"
echo "🚀 You can now start the inventory service"
