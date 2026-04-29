#!/bin/bash
set -e
export $(cat .env | xargs)
echo "Starting Payments..."
npm run start:dev --prefix ../../apps/payments
