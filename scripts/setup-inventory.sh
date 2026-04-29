#!/bin/bash

echo "🚀 Setting up Inventory Module Database..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Step 1: Checking PostgreSQL connection...${NC}"

# Check if PostgreSQL is accessible
DB_HOST=${PG_HOST:-localhost}
DB_PORT=${PG_PORT:-5432}
DB_USER=${PG_USERNAME:-postgres}
DB_PASSWORD=${PG_PASSWORD:-postgres}
DB_NAME=${PG_DATABASE:-inventory}

# Function to execute SQL
execute_sql() {
    local sql="$1"
    echo -e "${YELLOW}Executing: $sql${NC}"
    
    # Try different methods to connect to PostgreSQL
    if command -v psql &> /dev/null; then
        PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -c "$sql"
    elif command -v docker &> /dev/null && docker ps | grep -q postgres; then
        docker exec -i $(docker ps | grep postgres | awk '{print $1}' | head -1) psql -U $DB_USER -d postgres -c "$sql"
    else
        echo -e "${RED}❌ Cannot connect to PostgreSQL. Please make sure PostgreSQL is running.${NC}"
        echo -e "${YELLOW}💡 You can run the SQL commands manually:${NC}"
        echo "   $sql"
        return 1
    fi
}

# Step 2: Create database if not exists
echo -e "${YELLOW}Step 2: Creating inventory database...${NC}"
execute_sql "DROP DATABASE IF EXISTS inventory;"
execute_sql "CREATE DATABASE inventory;"

# Step 3: Create table structure
echo -e "${YELLOW}Step 3: Creating inventory table...${NC}"

# Use the SQL migration file
if [ -f "database/inventory_migration.sql" ]; then
    echo -e "${YELLOW}Running migration script...${NC}"
    
    if command -v psql &> /dev/null; then
        PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f database/inventory_migration.sql
    elif command -v docker &> /dev/null && docker ps | grep -q postgres; then
        docker exec -i $(docker ps | grep postgres | awk '{print $1}' | head -1) psql -U $DB_USER -d $DB_NAME < database/inventory_migration.sql
    else
        echo -e "${RED}❌ Please run the SQL file manually: database/inventory_migration.sql${NC}"
    fi
else
    echo -e "${RED}❌ Migration file not found: database/inventory_migration.sql${NC}"
    exit 1
fi

# Step 4: Enable synchronize back
echo -e "${YELLOW}Step 4: Updating TypeORM configuration...${NC}"
sed -i.bak 's/synchronize: false/synchronize: true/' libs/database/src/postgres-database.module.ts
echo -e "${GREEN}✅ Synchronize enabled${NC}"

echo -e "${GREEN}🎉 Inventory database setup completed!${NC}"
echo -e "${YELLOW}🚀 You can now start the inventory service:${NC}"
echo -e "   cd apps/inventory && npm run start:dev"
echo ""
echo -e "${YELLOW}📝 Test the setup:${NC}"
echo -e "   curl http://localhost:3002 # After starting the service"