#!/bin/bash
set -e
export $(cat .env | xargs)
echo "Starting Inventory..."
npm run start:dev --prefix ../../apps/inventory
