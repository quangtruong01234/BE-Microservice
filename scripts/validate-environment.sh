#!/bin/bash
# Pre-deployment validation script
# Chạy script này trước khi deploy để đảm bảo mọi thứ sẵn sàng

echo "🔍 Pre-Deployment Validation Starting..."
echo "=================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ERRORS=0

# Function to check and report
check_requirement() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✅ $2${NC}"
    else
        echo -e "${RED}❌ $2${NC}"
        ((ERRORS++))
    fi
}

# Check Node.js version
echo "Checking Node.js..."
node_version=$(node --version 2>/dev/null)
if [[ $node_version =~ ^v18\. ]]; then
    check_requirement 0 "Node.js 18.x installed: $node_version"
else
    check_requirement 1 "Node.js 18.x required, found: $node_version"
fi

# Check npm
npm --version >/dev/null 2>&1
check_requirement $? "npm is available"

# Check PM2
pm2 --version >/dev/null 2>&1
check_requirement $? "PM2 is installed"

# Check if we're in project directory
if [ -f "package.json" ] && [ -f "nest-cli.json" ]; then
    check_requirement 0 "In correct project directory"
else
    check_requirement 1 "Not in project directory or missing files"
fi

# Check environment template
if [ -f ".env.nodeA.template" ] && [ -f ".env.nodeB.template" ]; then
    check_requirement 0 "Environment templates exist"
else
    check_requirement 1 "Environment templates missing"
fi

# Check build scripts
if [ -f "scripts/build-nodeA.sh" ] && [ -f "scripts/build-nodeB.sh" ]; then
    check_requirement 0 "Build scripts exist"
else
    check_requirement 1 "Build scripts missing"
fi

# Check if scripts are executable
if [ -x "scripts/build-nodeA.sh" ] && [ -x "scripts/build-nodeB.sh" ]; then
    check_requirement 0 "Build scripts are executable"
else
    check_requirement 1 "Build scripts not executable (run: chmod +x scripts/*.sh)"
fi

# Check dependencies
if [ -f "node_modules/.package-lock.json" ] || [ -d "node_modules" ]; then
    check_requirement 0 "Dependencies appear to be installed"
else
    echo -e "${YELLOW}⚠️  Dependencies not installed. Run: npm ci${NC}"
fi

# Check environment file
if [ -f ".env" ]; then
    echo -e "${GREEN}✅ Environment file exists${NC}"
    
    # Check for required variables
    echo "Checking environment variables..."
    
    required_vars=("NODE_ENV" "GATEWAY_PORT" "ORDERS_PORT" "USER_PORT" "PRODUCT_PORT")
    for var in "${required_vars[@]}"; do
        if grep -q "^$var=" .env; then
            check_requirement 0 "$var is set"
        else
            check_requirement 1 "$var is missing"
        fi
    done
else
    echo -e "${RED}❌ .env file missing. Copy from template and configure.${NC}"
    ((ERRORS++))
fi

# Check disk space
available_space=$(df . | awk 'NR==2 {print $4}')
if [ "$available_space" -gt 1048576 ]; then  # 1GB in KB
    check_requirement 0 "Sufficient disk space available"
else
    check_requirement 1 "Low disk space. At least 1GB required"
fi

# Check memory
available_memory=$(free | awk 'NR==2{printf "%.0f", $7/1024}')
if [ "$available_memory" -gt 512 ]; then  # 512MB
    check_requirement 0 "Sufficient memory available"
else
    echo -e "${YELLOW}⚠️  Low memory available: ${available_memory}MB${NC}"
fi

# Network checks (if we can detect we're on EC2)
if command -v curl >/dev/null 2>&1; then
    check_requirement 0 "curl is available for health checks"
else
    check_requirement 1 "curl not available (install with: sudo apt install curl)"
fi

echo ""
echo "=================================="
if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}🎉 All checks passed! Ready for deployment.${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Run build script: ./scripts/build-nodeA.sh (or build-nodeB.sh)"
    echo "2. Start services: ./scripts/start-nodeA-prod.sh (or start-nodeB-prod.sh)"
    echo "3. Verify health: ./scripts/health-check-nodeA.sh (or health-check-nodeB.sh)"
    exit 0
else
    echo -e "${RED}❌ $ERRORS issues found. Please fix before deployment.${NC}"
    echo ""
    echo "Common fixes:"
    echo "- Install Node.js 18: curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash - && sudo apt-get install -y nodejs"
    echo "- Install PM2: sudo npm install -g pm2"  
    echo "- Install dependencies: npm ci"
    echo "- Make scripts executable: chmod +x scripts/*.sh"
    echo "- Copy environment: cp .env.nodeA.template .env (then edit)"
    exit 1
fi