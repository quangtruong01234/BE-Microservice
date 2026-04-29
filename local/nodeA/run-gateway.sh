#!/bin/bash
set -e
export $(cat .env | xargs)
echo "Starting Gateway..."
npm run start:dev --prefix ../../apps/gateway
