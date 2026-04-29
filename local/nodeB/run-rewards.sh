#!/bin/bash
set -e
export $(cat .env | xargs)
echo "Starting Rewards..."
npm run start:dev --prefix ../../apps/rewards
