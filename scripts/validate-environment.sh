#!/bin/bash
# Pre-deployment validation script.

echo "Pre-deployment validation starting..."
echo "===================================="

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ERRORS=0

check_requirement() {
    if [ "$1" -eq 0 ]; then
        echo -e "${GREEN}OK${NC} $2"
    else
        echo -e "${RED}FAIL${NC} $2"
        ((ERRORS++))
    fi
}

check_env_file() {
    local file_path="$1"
    local label="$2"
    shift 2

    if [ ! -f "$file_path" ]; then
        echo -e "${RED}FAIL${NC} $label env file exists at $file_path"
        ((ERRORS++))
        return
    fi

    echo -e "${GREEN}OK${NC} $label env file exists"
    echo "Checking $label required variables..."

    for var in "$@"; do
        if grep -q "^$var=" "$file_path"; then
            check_requirement 0 "$label $var is set"
        else
            check_requirement 1 "$label $var is missing"
        fi
    done
}

echo "Checking Node.js..."
node_version=$(node --version 2>/dev/null)
if [[ $node_version =~ ^v(18|20|22)\. ]]; then
    check_requirement 0 "Supported Node.js installed: $node_version"
else
    check_requirement 1 "Node.js 18, 20, or 22 required; found: $node_version"
fi

npm --version >/dev/null 2>&1
check_requirement $? "npm is available"

pm2 --version >/dev/null 2>&1
check_requirement $? "PM2 is installed"

if [ -f "package.json" ] && [ -f "nest-cli.json" ]; then
    check_requirement 0 "In project root"
else
    check_requirement 1 "Not in project root or missing package.json/nest-cli.json"
fi

if [ -f ".env.example" ] && [ -f "local/nodeA/.env.example" ] && [ -f "local/nodeB/.env.example" ]; then
    check_requirement 0 "Environment examples exist"
else
    check_requirement 1 "Environment examples missing"
fi

if [ -f "scripts/build-nodeA.sh" ] && [ -f "scripts/build-nodeB.sh" ]; then
    check_requirement 0 "Build scripts exist"
else
    check_requirement 1 "Build scripts missing"
fi

if [ -x "scripts/build-nodeA.sh" ] && [ -x "scripts/build-nodeB.sh" ]; then
    check_requirement 0 "Build scripts are executable"
else
    check_requirement 1 "Build scripts not executable; run: chmod +x scripts/*.sh"
fi

if [ -d "node_modules" ]; then
    check_requirement 0 "Dependencies appear to be installed"
else
    echo -e "${YELLOW}WARN${NC} Dependencies not installed. Run: npm ci"
fi

node_a_required_vars=(
    NODE_ENV
    GATEWAY_PORT
    JWT_SECRET
    FRONTEND_URL
    MYSQL_HOST
    MYSQL_PORT
    MYSQL_DATABASE
    MYSQL_USER
    MYSQL_PASSWORD
    REDIS_HOST
    REDIS_PORT
    RABBITMQ_HOST
    RABBITMQ_PORT
    RABBITMQ_USER
    RABBITMQ_PASS
    RABBITMQ_VHOST
    CLOUDINARY_CLOUD_NAME
    CLOUDINARY_API_KEY
    CLOUDINARY_API_SECRET
    GHN_API_URL
    GHN_API_TOKEN
    GHN_SHOP_ID
    GHN_WEBHOOK_SECRET
)

node_b_required_vars=(
    NODE_ENV
    PG_HOST
    PG_PORT
    PG_DATABASE
    PG_USERNAME
    PG_PASSWORD
    RABBITMQ_HOST
    RABBITMQ_PORT
    RABBITMQ_USER
    RABBITMQ_PASS
    RABBITMQ_VHOST
    ZALOPAY_APP_ID
    ZALOPAY_KEY1
    ZALOPAY_KEY2
    ZALOPAY_ENDPOINT
    VNP_TMN_CODE
    VNP_HASH_SECRET
    VNP_URL
    VNPAY_IPN_URL
)

check_env_file "local/nodeA/.env" "Node A" "${node_a_required_vars[@]}"
check_env_file "local/nodeB/.env" "Node B" "${node_b_required_vars[@]}"

available_space=$(df . | awk 'NR==2 {print $4}')
if [ "$available_space" -gt 1048576 ]; then
    check_requirement 0 "Sufficient disk space available"
else
    check_requirement 1 "Low disk space. At least 1GB required"
fi

if command -v free >/dev/null 2>&1; then
    available_memory=$(free | awk 'NR==2{printf "%.0f", $7/1024}')
    if [ "$available_memory" -gt 512 ]; then
        check_requirement 0 "Sufficient memory available"
    else
        echo -e "${YELLOW}WARN${NC} Low memory available: ${available_memory}MB"
    fi
fi

echo ""
echo "===================================="
if [ "$ERRORS" -eq 0 ]; then
    echo -e "${GREEN}All checks passed. Ready for deployment.${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Run build script: ./scripts/build-nodeA.sh or ./scripts/build-nodeB.sh"
    echo "2. Start services: npm run start:prod or the node-specific PM2 command"
    echo "3. Verify processes: pm2 list"
    exit 0
else
    echo -e "${RED}$ERRORS issue(s) found. Fix before deployment.${NC}"
    echo ""
    echo "Common fixes:"
    echo "- Install dependencies: npm ci"
    echo "- Install PM2: sudo npm install -g pm2"
    echo "- Make scripts executable: chmod +x scripts/*.sh"
    echo "- Copy envs: cp local/nodeA/.env.example local/nodeA/.env && cp local/nodeB/.env.example local/nodeB/.env"
    exit 1
fi
