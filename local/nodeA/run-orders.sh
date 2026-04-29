#!/bin/bash
set -e
export $(cat .env | xargs)
echo "Starting Orders microservice..."
npm run start:dev --prefix ../../apps/orders
