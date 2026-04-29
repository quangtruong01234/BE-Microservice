-- =========================================================================
-- ORDER MODULE DDL - E-commerce System (Shopee-inspired)
-- =========================================================================
-- Author: Senior Developer
-- Date: December 2, 2025
-- Description: Complete DDL for Order Management Module
-- =========================================================================

-- Drop tables if exists (for development/reset purposes)
DROP TABLE IF EXISTS order_status_history;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS order_promotions;
DROP TABLE IF EXISTS order_shipping;
DROP TABLE IF EXISTS order_payments;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS order_sequences;

-- =========================================================================
-- 1. ORDER SEQUENCE TABLE (for generating order numbers)
-- =========================================================================
CREATE TABLE order_sequences (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    prefix VARCHAR(10) NOT NULL DEFAULT 'ORD',
    current_value BIGINT NOT NULL DEFAULT 0,
    date_part VARCHAR(8) NOT NULL, -- YYYYMMDD
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_order_seq_date (prefix, date_part)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================================
-- 2. MAIN ORDERS TABLE
-- =========================================================================
CREATE TABLE orders (
    -- Primary identifiers
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    order_number VARCHAR(32) NOT NULL UNIQUE COMMENT 'Human readable order number: ORD20251202000001',
    
    -- Customer information
    user_id BIGINT NOT NULL COMMENT 'Reference to user/customer',
    customer_name VARCHAR(255) NOT NULL,
    customer_email VARCHAR(255),
    customer_phone VARCHAR(20),
    
    -- Order financial details
    subtotal DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT 'Sum of all item prices',
    shipping_fee DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT 'Final payable amount',
    
    -- Order status and workflow
    status ENUM(
        'PENDING',          -- Initial state, waiting for payment
        'PAID',             -- Payment confirmed
        'PROCESSING',       -- Order being prepared
        'SHIPPED',          -- Order dispatched
        'DELIVERED',        -- Successfully delivered
        'CANCELLED',        -- Cancelled by customer/system
        'REFUNDED',         -- Money returned to customer
        'FAILED'            -- Order processing failed
    ) NOT NULL DEFAULT 'PENDING',
    
    -- Business metadata
    currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
    order_source VARCHAR(50) DEFAULT 'WEB' COMMENT 'WEB, MOBILE_APP, API, ADMIN',
    sales_channel VARCHAR(50) DEFAULT 'ONLINE' COMMENT 'ONLINE, STORE, MARKETPLACE',
    
    -- Shipping information
    shipping_method VARCHAR(50) COMMENT 'STANDARD, EXPRESS, SAME_DAY',
    estimated_delivery_date DATE,
    actual_delivery_date DATE,
    
    -- Special flags
    is_gift BOOLEAN DEFAULT FALSE,
    gift_message TEXT,
    is_urgent BOOLEAN DEFAULT FALSE,
    requires_signature BOOLEAN DEFAULT FALSE,
    
    -- Audit trail
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by BIGINT COMMENT 'Who created this order (user_id or admin_id)',
    updated_by BIGINT COMMENT 'Last person who modified this order',
    
    -- Additional metadata (JSON for flexibility)
    metadata JSON COMMENT 'Additional order data, tags, custom fields',
    
    -- Indexes
    INDEX idx_orders_user_id (user_id),
    INDEX idx_orders_status (status),
    INDEX idx_orders_created_at (created_at),
    INDEX idx_orders_order_number (order_number),
    INDEX idx_orders_status_created (status, created_at),
    INDEX idx_orders_user_status (user_id, status)
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Main orders table storing order header information';

-- =========================================================================
-- 3. ORDER ITEMS TABLE
-- =========================================================================
CREATE TABLE order_items (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    order_id BIGINT NOT NULL,
    
    -- Product information
    product_id BIGINT NOT NULL,
    product_sku VARCHAR(100) NOT NULL COMMENT 'Product SKU at time of order',
    product_name VARCHAR(500) NOT NULL COMMENT 'Product name snapshot',
    product_image_url VARCHAR(1000) COMMENT 'Main product image',
    
    -- Variant information (for products with variants)
    variant_id BIGINT COMMENT 'Product variant ID if applicable',
    variant_attributes JSON COMMENT 'Size, Color, etc. at time of order',
    
    -- Pricing and quantity
    unit_price DECIMAL(12,2) NOT NULL COMMENT 'Price per unit at time of order',
    quantity INT NOT NULL DEFAULT 1,
    subtotal DECIMAL(12,2) NOT NULL COMMENT 'unit_price * quantity',
    
    -- Discount applied to this item
    item_discount DECIMAL(12,2) DEFAULT 0.00,
    final_price DECIMAL(12,2) NOT NULL COMMENT 'subtotal - item_discount',
    
    -- Fulfillment tracking
    fulfillment_status ENUM(
        'PENDING',
        'RESERVED',     -- Stock reserved
        'PICKED',       -- Item picked from warehouse
        'PACKED',       -- Item packed for shipping
        'SHIPPED',      -- Item shipped
        'DELIVERED',    -- Item delivered
        'CANCELLED',    -- Item cancelled
        'REFUNDED'      -- Item refunded
    ) DEFAULT 'PENDING',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Foreign key constraints
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    
    -- Indexes
    INDEX idx_order_items_order_id (order_id),
    INDEX idx_order_items_product_id (product_id),
    INDEX idx_order_items_sku (product_sku),
    INDEX idx_order_items_status (fulfillment_status)
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Order line items with product details and fulfillment status';

-- =========================================================================
-- 4. ORDER SHIPPING TABLE
-- =========================================================================
CREATE TABLE order_shipping (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    order_id BIGINT NOT NULL,
    
    -- Shipping address
    recipient_name VARCHAR(255) NOT NULL,
    recipient_phone VARCHAR(20),
    address_line1 VARCHAR(500) NOT NULL,
    address_line2 VARCHAR(500),
    city VARCHAR(100) NOT NULL,
    state_province VARCHAR(100),
    postal_code VARCHAR(20),
    country VARCHAR(100) NOT NULL DEFAULT 'Vietnam',
    
    -- Shipping details
    shipping_method VARCHAR(50) NOT NULL,
    carrier VARCHAR(100) COMMENT 'Shipping carrier: Giao Hang Nhanh, Giao Hang Tiet Kiem, etc.',
    tracking_number VARCHAR(100),
    tracking_url VARCHAR(500),
    
    -- Timing
    estimated_delivery_date DATE,
    actual_ship_date DATE,
    actual_delivery_date DATE,
    
    -- Special instructions
    delivery_instructions TEXT,
    is_signature_required BOOLEAN DEFAULT FALSE,
    is_fragile BOOLEAN DEFAULT FALSE,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Foreign key constraints
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    
    -- Indexes
    INDEX idx_shipping_order_id (order_id),
    INDEX idx_shipping_tracking (tracking_number),
    INDEX idx_shipping_carrier (carrier)
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Order shipping and delivery information';

-- =========================================================================
-- 5. ORDER PAYMENTS TABLE
-- =========================================================================
CREATE TABLE order_payments (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    order_id BIGINT NOT NULL,
    
    -- Payment details
    payment_method ENUM(
        'CREDIT_CARD',
        'DEBIT_CARD', 
        'BANK_TRANSFER',
        'E_WALLET',     -- MoMo, ZaloPay, etc.
        'COD',          -- Cash on Delivery
        'INSTALLMENT',
        'CRYPTO'
    ) NOT NULL,
    
    payment_provider VARCHAR(100) COMMENT 'Visa, MasterCard, MoMo, ZaloPay, etc.',
    
    -- Amount details
    amount DECIMAL(12,2) NOT NULL,
    currency_code VARCHAR(3) NOT NULL DEFAULT 'VND',
    
    -- Payment status
    payment_status ENUM(
        'PENDING',
        'PROCESSING',
        'COMPLETED',
        'FAILED',
        'CANCELLED',
        'REFUNDED',
        'PARTIALLY_REFUNDED'
    ) NOT NULL DEFAULT 'PENDING',
    
    -- Transaction references
    transaction_id VARCHAR(255) COMMENT 'External payment gateway transaction ID',
    gateway_reference VARCHAR(255) COMMENT 'Payment gateway reference',
    
    -- Payment timing
    paid_at TIMESTAMP NULL,
    expires_at TIMESTAMP NULL COMMENT 'Payment expiration time',
    
    -- Refund information
    refund_amount DECIMAL(12,2) DEFAULT 0.00,
    refund_reason TEXT,
    refunded_at TIMESTAMP NULL,
    
    -- Additional payment data
    payment_metadata JSON COMMENT 'Gateway-specific payment data',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Foreign key constraints
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    
    -- Indexes
    INDEX idx_payments_order_id (order_id),
    INDEX idx_payments_status (payment_status),
    INDEX idx_payments_method (payment_method),
    INDEX idx_payments_transaction (transaction_id),
    INDEX idx_payments_paid_at (paid_at)
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Order payment transactions and status tracking';

-- =========================================================================
-- 6. ORDER PROMOTIONS/DISCOUNTS TABLE
-- =========================================================================
CREATE TABLE order_promotions (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    order_id BIGINT NOT NULL,
    
    -- Promotion details
    promotion_id BIGINT COMMENT 'Reference to promotions master table',
    promotion_code VARCHAR(50) COMMENT 'Coupon/Promo code used',
    promotion_name VARCHAR(255) NOT NULL,
    promotion_type ENUM(
        'PERCENTAGE_DISCOUNT',
        'FIXED_AMOUNT_DISCOUNT',
        'FREE_SHIPPING',
        'BUY_X_GET_Y',
        'CASHBACK',
        'LOYALTY_POINTS'
    ) NOT NULL,
    
    -- Discount calculation
    discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    discount_percentage DECIMAL(5,2) COMMENT 'If percentage discount',
    
    -- Conditions and limits
    minimum_order_amount DECIMAL(12,2) COMMENT 'Min order value to apply',
    maximum_discount_amount DECIMAL(12,2) COMMENT 'Max discount cap',
    
    -- Application scope
    applies_to ENUM('ORDER_TOTAL', 'SHIPPING', 'SPECIFIC_ITEMS') DEFAULT 'ORDER_TOTAL',
    applicable_items JSON COMMENT 'Product IDs if applies to specific items',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Foreign key constraints
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    
    -- Indexes
    INDEX idx_promotions_order_id (order_id),
    INDEX idx_promotions_code (promotion_code),
    INDEX idx_promotions_type (promotion_type)
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Promotions and discounts applied to orders';

-- =========================================================================
-- 7. ORDER STATUS HISTORY TABLE
-- =========================================================================
CREATE TABLE order_status_history (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    order_id BIGINT NOT NULL,
    
    -- Status change details
    previous_status VARCHAR(50),
    new_status VARCHAR(50) NOT NULL,
    status_reason VARCHAR(255) COMMENT 'Reason for status change',
    
    -- Change context
    changed_by BIGINT COMMENT 'User ID who made the change',
    change_source VARCHAR(50) DEFAULT 'SYSTEM' COMMENT 'SYSTEM, USER, ADMIN, API',
    
    -- Additional information
    notes TEXT COMMENT 'Additional notes about the status change',
    metadata JSON COMMENT 'Additional context data',
    
    -- Timestamp
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Foreign key constraints
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    
    -- Indexes
    INDEX idx_history_order_id (order_id),
    INDEX idx_history_status (new_status),
    INDEX idx_history_created (created_at),
    INDEX idx_history_changed_by (changed_by)
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Audit trail of order status changes';

-- =========================================================================
-- STORED PROCEDURES AND FUNCTIONS
-- =========================================================================

-- Function to generate order number
DELIMITER $$
CREATE FUNCTION generate_order_number(order_prefix VARCHAR(10))
RETURNS VARCHAR(32)
READS SQL DATA
DETERMINISTIC
BEGIN
    DECLARE current_date_part VARCHAR(8);
    DECLARE next_sequence BIGINT;
    DECLARE order_number VARCHAR(32);
    
    -- Get current date in YYYYMMDD format
    SET current_date_part = DATE_FORMAT(NOW(), '%Y%m%d');
    
    -- Get and increment sequence for today
    INSERT INTO order_sequences (prefix, date_part, current_value) 
    VALUES (order_prefix, current_date_part, 1)
    ON DUPLICATE KEY UPDATE current_value = current_value + 1;
    
    SELECT current_value INTO next_sequence 
    FROM order_sequences 
    WHERE prefix = order_prefix AND date_part = current_date_part;
    
    -- Generate order number: ORD20251202000001
    SET order_number = CONCAT(order_prefix, current_date_part, LPAD(next_sequence, 6, '0'));
    
    RETURN order_number;
END$$
DELIMITER ;

-- Procedure to update order totals
DELIMITER $$
CREATE PROCEDURE update_order_totals(IN p_order_id BIGINT)
BEGIN
    DECLARE v_subtotal DECIMAL(12,2) DEFAULT 0.00;
    DECLARE v_discount_total DECIMAL(12,2) DEFAULT 0.00;
    
    -- Calculate subtotal from order items
    SELECT COALESCE(SUM(final_price), 0) INTO v_subtotal
    FROM order_items 
    WHERE order_id = p_order_id;
    
    -- Calculate total discounts from promotions
    SELECT COALESCE(SUM(discount_amount), 0) INTO v_discount_total
    FROM order_promotions 
    WHERE order_id = p_order_id;
    
    -- Update order totals
    UPDATE orders 
    SET subtotal = v_subtotal,
        discount_amount = v_discount_total,
        total_amount = v_subtotal + shipping_fee + tax_amount - v_discount_total,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_order_id;
END$$
DELIMITER ;

-- =========================================================================
-- TRIGGERS
-- =========================================================================

-- Trigger to auto-generate order number on insert
DELIMITER $$
CREATE TRIGGER tr_orders_before_insert 
BEFORE INSERT ON orders
FOR EACH ROW
BEGIN
    IF NEW.order_number IS NULL OR NEW.order_number = '' THEN
        SET NEW.order_number = generate_order_number('ORD');
    END IF;
END$$
DELIMITER ;

-- Trigger to log status changes
DELIMITER $$
CREATE TRIGGER tr_orders_after_update 
AFTER UPDATE ON orders
FOR EACH ROW
BEGIN
    IF OLD.status != NEW.status THEN
        INSERT INTO order_status_history (
            order_id, 
            previous_status, 
            new_status,
            changed_by,
            change_source,
            notes
        ) VALUES (
            NEW.id,
            OLD.status,
            NEW.status,
            NEW.updated_by,
            'SYSTEM',
            CONCAT('Status changed from ', OLD.status, ' to ', NEW.status)
        );
    END IF;
END$$
DELIMITER ;

-- Trigger to update order totals when items change
DELIMITER $$
CREATE TRIGGER tr_order_items_after_insert
AFTER INSERT ON order_items
FOR EACH ROW
BEGIN
    CALL update_order_totals(NEW.order_id);
END$$

CREATE TRIGGER tr_order_items_after_update
AFTER UPDATE ON order_items
FOR EACH ROW
BEGIN
    CALL update_order_totals(NEW.order_id);
END$$

CREATE TRIGGER tr_order_items_after_delete
AFTER DELETE ON order_items
FOR EACH ROW
BEGIN
    CALL update_order_totals(OLD.order_id);
END$$
DELIMITER ;

-- =========================================================================
-- SAMPLE DATA INSERTS (for testing)
-- =========================================================================

-- Insert sample order sequence
INSERT INTO order_sequences (prefix, date_part, current_value) 
VALUES ('ORD', DATE_FORMAT(NOW(), '%Y%m%d'), 0);

-- Insert sample order
INSERT INTO orders (
    user_id, customer_name, customer_email, customer_phone,
    subtotal, shipping_fee, tax_amount, total_amount,
    status, currency_code, order_source
) VALUES (
    12345, 'Nguyen Van A', 'nguyenvana@example.com', '+84901234567',
    500000.00, 30000.00, 55000.00, 585000.00,
    'PENDING', 'VND', 'WEB'
);

-- =========================================================================
-- PERFORMANCE OPTIMIZATION NOTES
-- =========================================================================
/*
1. Partitioning Strategy:
   - Consider partitioning orders table by created_at (monthly partitions)
   - Partition order_status_history by created_at for better performance

2. Indexing Strategy:
   - Compound indexes on frequently queried combinations
   - Consider covering indexes for read-heavy queries

3. Archiving Strategy:
   - Archive completed orders older than 2 years to separate tables
   - Keep active orders (pending, processing) in main tables

4. Monitoring:
   - Monitor slow queries on order lookups
   - Track table growth and partition effectiveness
   - Monitor trigger performance impact
*/