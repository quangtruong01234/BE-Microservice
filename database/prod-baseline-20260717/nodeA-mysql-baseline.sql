-- TryBuy production baseline: nodeA (mysql)
-- Generated from the current TypeORM entity metadata; schema + required reference data only.
-- Import into an empty database. Do not run against an existing schema.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
SET FOREIGN_KEY_CHECKS = 0;
START TRANSACTION;

CREATE TABLE `cart_items` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `cart_id` INT NOT NULL,
  `product_id` INT NOT NULL,
  `sku_id` INT NULL,
  `sku_tier_idx` VARCHAR(50) NULL,
  `quantity` INT NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `carts` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `user_id` INT NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `order_return_requests` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `public_id` VARCHAR(32) NULL,
  `order_id` INT NOT NULL,
  `user_id` BIGINT NOT NULL,
  `reason` VARCHAR(1000) NOT NULL,
  `status` ENUM('pending_review', 'approved', 'rejected') NOT NULL DEFAULT 'pending_review',
  `reject_reason` VARCHAR(1000) NULL DEFAULT NULL,
  `previous_order_status` VARCHAR(30) NULL DEFAULT NULL,
  `refund_amount` DECIMAL(12,2) NULL DEFAULT NULL,
  `refund_method` VARCHAR(30) NULL DEFAULT NULL,
  `refund_status` VARCHAR(30) NULL DEFAULT NULL,
  `reviewed_by` BIGINT NULL DEFAULT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `order_items` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `order_id` INT NOT NULL,
  `product_id` BIGINT NOT NULL,
  `product_public_id` VARCHAR(32) NULL DEFAULT NULL,
  `seller_id` INT NOT NULL,
  `product_name` VARCHAR(255) NOT NULL,
  `product_image` VARCHAR(2048) NULL DEFAULT NULL,
  `quantity` INT NOT NULL,
  `price` DECIMAL(12,2) NOT NULL,
  `weight` INT NULL DEFAULT NULL,
  `sku_id` INT NULL DEFAULT NULL,
  `sku_tier_idx` VARCHAR(255) NULL DEFAULT NULL,
  `sku_label` VARCHAR(512) NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `orders` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `public_id` VARCHAR(32) NULL DEFAULT NULL,
  `user_id` BIGINT NOT NULL,
  `seller_id` INT NOT NULL,
  `status` ENUM('pending', 'confirmed', 'processing', 'shipped', 'delivering', 'completed', 'canceled', 'return_requested', 'refunded') NOT NULL DEFAULT 'pending',
  `total` DECIMAL(12,2) NOT NULL,
  `payment_method` ENUM('zalopay', 'vnpay', 'cod') NOT NULL,
  `shipping_address` VARCHAR(500) NOT NULL,
  `cod_amount` DECIMAL(12,2) NULL DEFAULT NULL,
  `shipping_fee` DECIMAL(12,2) NULL DEFAULT NULL,
  `ghn_order_code` VARCHAR(100) NULL DEFAULT NULL,
  `reservation_key` VARCHAR(36) NOT NULL,
  `voucher_code` VARCHAR(64) NULL DEFAULT NULL,
  `discount_amount` DECIMAL(12,2) NULL DEFAULT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `shipping_history` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `order_id` BIGINT NOT NULL,
  `type` ENUM('webhook', 'manual_sync', 'action') NOT NULL,
  `actor_id` INT NULL DEFAULT NULL,
  `action` VARCHAR(100) NOT NULL,
  `previous_status` VARCHAR(50) NULL DEFAULT NULL,
  `new_status` VARCHAR(50) NULL DEFAULT NULL,
  `ghn_status` VARCHAR(100) NULL DEFAULT NULL,
  `success` TINYINT NOT NULL DEFAULT 1,
  `message` VARCHAR(500) NULL DEFAULT NULL,
  `payload_summary` JSON NULL DEFAULT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `voucher_redemptions` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `voucher_id` INT NOT NULL,
  `user_id` BIGINT NOT NULL,
  `order_id` INT NOT NULL,
  `discount_amount` DECIMAL(12,2) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `vouchers` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `code` VARCHAR(64) NOT NULL,
  `description` VARCHAR(255) NULL DEFAULT NULL,
  `discount_type` ENUM('percent', 'fixed') NOT NULL,
  `discount_value` DECIMAL(12,2) NOT NULL,
  `min_order_amount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `max_discount_amount` DECIMAL(12,2) NULL DEFAULT NULL,
  `usage_limit` INT NULL DEFAULT NULL,
  `used_count` INT NOT NULL DEFAULT 0,
  `per_user_limit` INT NULL DEFAULT NULL,
  `starts_at` DATETIME NULL DEFAULT NULL,
  `expires_at` DATETIME NULL DEFAULT NULL,
  `is_active` TINYINT NOT NULL DEFAULT 1,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `resources` (
  `res_id` INT AUTO_INCREMENT NOT NULL,
  `res_name` VARCHAR(255) NOT NULL,
  `res_slug` VARCHAR(255) NOT NULL,
  `res_description` VARCHAR(255) NOT NULL DEFAULT '',
  `res_created_by` VARCHAR(255) NOT NULL,
  `createdAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`res_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `roles` (
  `rol_id` INT AUTO_INCREMENT NOT NULL,
  `rol_name` ENUM('user', 'shop', 'admin', 'logistics_operator', 'shipping_manager') NOT NULL DEFAULT 'user',
  `rol_slug` VARCHAR(255) NOT NULL,
  `rol_status` ENUM('active', 'block', 'pending') NOT NULL DEFAULT 'active',
  `rol_description` VARCHAR(255) NOT NULL DEFAULT '',
  `rol_created_by` VARCHAR(255) NOT NULL,
  `rol_updated_by` VARCHAR(255) NOT NULL,
  `rol_grants` JSON NULL,
  `createdAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`rol_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `user_addresses` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `public_id` VARCHAR(32) NULL,
  `user_id` INT NOT NULL,
  `recipient_name` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(20) NOT NULL,
  `address_line` VARCHAR(500) NOT NULL,
  `province_id` INT NOT NULL,
  `province_name` VARCHAR(255) NOT NULL,
  `district_id` INT NOT NULL,
  `district_name` VARCHAR(255) NOT NULL,
  `ward_code` VARCHAR(50) NOT NULL,
  `ward_name` VARCHAR(255) NOT NULL,
  `is_default` TINYINT NOT NULL DEFAULT 0,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `users` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `public_id` VARCHAR(32) NULL DEFAULT NULL,
  `username` VARCHAR(255) NOT NULL,
  `password` VARCHAR(255) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `name` VARCHAR(255) NULL,
  `avatar` VARCHAR(255) NULL,
  `isActive` TINYINT NOT NULL DEFAULT 1,
  `createdAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `role_id` INT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `categories` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `is_active` TINYINT NOT NULL DEFAULT 1,
  `status` ENUM('pending', 'active', 'rejected') NOT NULL DEFAULT 'pending',
  `submitted_by` INT NULL,
  `review_note` VARCHAR(255) NULL,
  `created_at` TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `product_skus` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `product_id` BIGINT NOT NULL,
  `tier_idx` VARCHAR(50) NOT NULL,
  `price` DECIMAL(12,2) NOT NULL,
  `stock_quantity` INT NOT NULL DEFAULT 0,
  `sku` VARCHAR(100) NULL,
  `is_active` TINYINT NOT NULL DEFAULT 1,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `products` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `public_id` VARCHAR(32) NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `price` DECIMAL(12,2) NULL DEFAULT NULL,
  `stock_quantity` INT NULL DEFAULT NULL,
  `sku` VARCHAR(100) NULL DEFAULT NULL,
  `brand_id` BIGINT NULL,
  `user_id` BIGINT NULL,
  `image_urls` JSON NULL DEFAULT NULL,
  `is_active` TINYINT NOT NULL DEFAULT 1,
  `approval_blocked` TINYINT NOT NULL DEFAULT 0,
  `likes_count` INT NOT NULL DEFAULT 0,
  `comments_count` INT NOT NULL DEFAULT 0,
  `shares_count` INT NOT NULL DEFAULT 0,
  `view_count` INT NOT NULL DEFAULT 0,
  `is_featured` TINYINT NOT NULL DEFAULT FALSE,
  `is_trending` TINYINT NOT NULL DEFAULT FALSE,
  `condition` VARCHAR(50) NULL DEFAULT 'new',
  `seller_notes` TEXT NULL,
  `rating` DECIMAL(3,2) NOT NULL DEFAULT 0.00,
  `rating_count` INT NOT NULL DEFAULT 0,
  `weight` INT NULL DEFAULT NULL,
  `variations` JSON NULL DEFAULT NULL,
  `image_phashes` JSON NULL DEFAULT NULL,
  `risk_score` INT NOT NULL DEFAULT 0,
  `risk_flags` JSON NULL DEFAULT NULL,
  `risk_scoring_status` ENUM('pending', 'ready', 'failed') NOT NULL DEFAULT 'pending',
  `risk_scored_at` TIMESTAMP NULL,
  `risk_scoring_attempts` INT NOT NULL DEFAULT 0,
  `risk_next_retry_at` TIMESTAMP NULL,
  `risk_last_error` VARCHAR(500) NULL,
  `created_at` TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `brands` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `is_active` TINYINT NOT NULL DEFAULT 1,
  `status` ENUM('pending', 'active', 'rejected') NOT NULL DEFAULT 'pending',
  `submitted_by` INT NULL,
  `review_note` VARCHAR(255) NULL,
  `created_at` TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `product_reviews` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `product_id` INT NOT NULL,
  `user_id` INT NOT NULL,
  `rating` TINYINT NOT NULL,
  `comment` TEXT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `product_risk_feedback` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `product_id` BIGINT NOT NULL,
  `moderator_id` BIGINT NOT NULL,
  `decision` ENUM('confirmed_duplicate', 'dismissed') NOT NULL,
  `note` VARCHAR(500) NULL,
  `created_at` TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `wishlist_items` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `user_id` INT NOT NULL,
  `product_id` BIGINT NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `comments` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `public_id` VARCHAR(32) NOT NULL,
  `post_id` INT NOT NULL,
  `user_id` INT NOT NULL,
  `content` VARCHAR(1000) NOT NULL,
  `created_at` TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `mpath` VARCHAR(255) NULL DEFAULT '',
  `parentId` INT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `follows` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `follower_id` INT NOT NULL,
  `following_id` INT NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `likes` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `user_id` INT NOT NULL,
  `post_id` INT NOT NULL,
  `created_at` TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `post_likes` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `post_id` INT NOT NULL,
  `user_id` INT NOT NULL,
  `created_at` TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `post_reports` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `post_id` INT NOT NULL,
  `reporter_id` INT NOT NULL,
  `reason` VARCHAR(500) NOT NULL,
  `status` ENUM('pending', 'resolved', 'dismissed') NOT NULL DEFAULT 'pending',
  `resolved_by` INT NULL,
  `resolved_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `posts` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `public_id` VARCHAR(32) NOT NULL,
  `user_id` INT NOT NULL,
  `product_id` INT NULL DEFAULT NULL,
  `content` TEXT NOT NULL,
  `image_urls` JSON NULL DEFAULT NULL,
  `video_url` VARCHAR(500) NULL DEFAULT NULL,
  `is_hidden` TINYINT NOT NULL DEFAULT 0,
  `hidden_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `notifications` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `public_id` VARCHAR(32) NULL,
  `user_id` INT NOT NULL,
  `type` VARCHAR(50) NOT NULL,
  `order_id` BIGINT NULL,
  `post_id` INT NULL,
  `actor_id` INT NULL,
  `preview` VARCHAR(255) NULL,
  `message` VARCHAR(255) NOT NULL,
  `is_read` TINYINT NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `messages` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `public_id` VARCHAR(32) NULL DEFAULT NULL,
  `conversation_id` INT NOT NULL,
  `sender_id` INT NOT NULL,
  `content` TEXT NOT NULL,
  `parent_message_id` BIGINT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `conversations` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `public_id` VARCHAR(32) NULL DEFAULT NULL,
  `user1_id` INT NOT NULL,
  `user2_id` INT NOT NULL,
  `user1_last_read_at` DATETIME NULL,
  `user2_last_read_at` DATETIME NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `product_categories` (
  `product_id` BIGINT NOT NULL,
  `category_id` BIGINT NOT NULL,
  PRIMARY KEY (`product_id`, `category_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `IDX_86175614a7ea522ad1e7d8317c` ON `order_return_requests` (`public_id`);
CREATE INDEX `idx_order_items_product_id` ON `order_items` (`product_id`);
CREATE INDEX `idx_order_items_seller_id` ON `order_items` (`seller_id`);
CREATE INDEX `idx_orders_ghn_order_code` ON `orders` (`ghn_order_code`);
CREATE INDEX `idx_orders_status_created_at` ON `orders` (`status`, `created_at`);
CREATE INDEX `idx_orders_seller_id` ON `orders` (`seller_id`);
CREATE INDEX `idx_orders_user_id` ON `orders` (`user_id`);
CREATE UNIQUE INDEX `IDX_c545f013afea21ab10d0dc7b70` ON `orders` (`public_id`);
CREATE UNIQUE INDEX `IDX_08289c9429d180fc2c002fa571` ON `resources` (`res_slug`);
CREATE UNIQUE INDEX `IDX_9aef970bf9797a772cb9fce3e8` ON `roles` (`rol_slug`);
CREATE INDEX `IDX_7a5100ce0548ef27a6f1533a5c` ON `user_addresses` (`user_id`);
CREATE UNIQUE INDEX `IDX_63cc6d6791a42c39c12570ac22` ON `user_addresses` (`public_id`);
CREATE UNIQUE INDEX `IDX_848b8b23bf0748243d4e1e76ae` ON `users` (`public_id`);
CREATE UNIQUE INDEX `IDX_fe0bb3f6520ee0469504521e71` ON `users` (`username`);
CREATE UNIQUE INDEX `IDX_97672ac88f789774dd47f7c8be` ON `users` (`email`);
CREATE INDEX `idx_products_price` ON `products` (`price`);
CREATE INDEX `idx_products_brand_id` ON `products` (`brand_id`);
CREATE INDEX `idx_products_is_active` ON `products` (`is_active`);
CREATE INDEX `idx_products_is_featured` ON `products` (`is_featured`);
CREATE INDEX `idx_products_is_trending` ON `products` (`is_trending`);
CREATE INDEX `idx_products_condition` ON `products` (`condition`);
CREATE INDEX `idx_products_rating` ON `products` (`rating`);
CREATE INDEX `idx_products_risk_score` ON `products` (`risk_score`);
CREATE INDEX `idx_products_risk_scoring_queue` ON `products` (`risk_scoring_status`);
CREATE UNIQUE INDEX `IDX_a9fdc2cfb127916506c619a9a4` ON `products` (`public_id`);
CREATE UNIQUE INDEX `IDX_c44ac33a05b144dd0d9ddcf932` ON `products` (`sku`);
CREATE UNIQUE INDEX `IDX_a603ea521ec26c2d107ea851e7` ON `product_reviews` (`product_id`, `user_id`);
CREATE UNIQUE INDEX `uq_product_risk_feedback_product` ON `product_risk_feedback` (`product_id`);
CREATE INDEX `idx_wishlist_items_product` ON `wishlist_items` (`product_id`);
CREATE INDEX `idx_wishlist_items_user_created` ON `wishlist_items` (`user_id`, `created_at`);
CREATE UNIQUE INDEX `IDX_e0584a3664156caa678765afad` ON `wishlist_items` (`user_id`, `product_id`);
CREATE INDEX `idx_comments_post_id_created_at` ON `comments` (`post_id`, `created_at`);
CREATE UNIQUE INDEX `IDX_a37022e07d609269ec72c36c84` ON `comments` (`public_id`);
CREATE INDEX `IDX_54b5dc2739f2dea57900933db6` ON `follows` (`follower_id`);
CREATE INDEX `IDX_c518e3988b9c057920afaf2d8c` ON `follows` (`following_id`);
CREATE UNIQUE INDEX `uq_follows_follower_following` ON `follows` (`follower_id`, `following_id`);
CREATE INDEX `IDX_741df9b9b72f328a6d6f63e79f` ON `likes` (`post_id`);
CREATE UNIQUE INDEX `uq_likes_user_post` ON `likes` (`user_id`, `post_id`);
CREATE UNIQUE INDEX `IDX_8f64693922a9e8c4e2605850d0` ON `post_likes` (`post_id`, `user_id`);
CREATE INDEX `IDX_611b70ef1c1e75943221918b84` ON `post_reports` (`post_id`);
CREATE UNIQUE INDEX `IDX_d465dd4576e97d6f0ff35537fa` ON `post_reports` (`post_id`, `reporter_id`);
CREATE INDEX `idx_posts_user_visible_created_at` ON `posts` (`user_id`, `is_hidden`, `created_at`);
CREATE INDEX `idx_posts_visible_created_at` ON `posts` (`is_hidden`, `created_at`);
CREATE UNIQUE INDEX `IDX_f10a87fb6df56a8d5387b0f52e` ON `posts` (`public_id`);
CREATE UNIQUE INDEX `IDX_ffd14df0a11028f62d799bb8ff` ON `notifications` (`public_id`);
CREATE INDEX `idx_messages_conversation_created_at` ON `messages` (`conversation_id`, `created_at`);
CREATE UNIQUE INDEX `IDX_c59e28ad622c26bdaaa79f6402` ON `messages` (`public_id`);
CREATE UNIQUE INDEX `IDX_8849dad6b99738fcbce8dc1ef3` ON `conversations` (`public_id`);
CREATE INDEX `IDX_8748b4a0e8de6d266f2bbc877f` ON `product_categories` (`product_id`);
CREATE INDEX `IDX_9148da8f26fc248e77a387e311` ON `product_categories` (`category_id`);

ALTER TABLE `cart_items` ADD CONSTRAINT `FK_6385a745d9e12a89b859bb25623` FOREIGN KEY (`cart_id`) REFERENCES `carts` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE `order_items` ADD CONSTRAINT `FK_145532db85752b29c57d2b7b1f1` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE `users` ADD CONSTRAINT `FK_a2cecd1a3531c0b041e29ba46e1` FOREIGN KEY (`role_id`) REFERENCES `roles` (`rol_id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE `product_skus` ADD CONSTRAINT `FK_e684b596b9ec2474335e7695267` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE `products` ADD CONSTRAINT `FK_1530a6f15d3c79d1b70be98f2be` FOREIGN KEY (`brand_id`) REFERENCES `brands` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE `wishlist_items` ADD CONSTRAINT `FK_177397e044732e7e9c0215cd5b7` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE `comments` ADD CONSTRAINT `FK_8770bd9030a3d13c5f79a7d2e81` FOREIGN KEY (`parentId`) REFERENCES `comments` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE `messages` ADD CONSTRAINT `FK_3bc55a7c3f9ed54b520bb5cfe23` FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE `messages` ADD CONSTRAINT `FK_72ffa22d68b72a09d5700e4463f` FOREIGN KEY (`parent_message_id`) REFERENCES `messages` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE `product_categories` ADD CONSTRAINT `FK_8748b4a0e8de6d266f2bbc877f6` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `product_categories` ADD CONSTRAINT `FK_9148da8f26fc248e77a387e3112` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Required authorization reference data; no users or demo records.
INSERT INTO `resources` (`res_name`, `res_slug`, `res_description`, `res_created_by`) VALUES
  ('product', 'product', 'Product management', 'system'),
  ('order', 'order', 'Order management', 'system'),
  ('user', 'user', 'User management', 'system'),
  ('inventory', 'inventory', 'Inventory management', 'system'),
  ('payment', 'payment', 'Payment management', 'system'),
  ('rewards', 'rewards', 'Rewards management', 'system'),
  ('shipping', 'shipping', 'Shipping / GHN logistics management', 'system'),
  ('brand', 'brand', 'Brand moderation', 'system'),
  ('category', 'category', 'Category moderation', 'system'),
  ('post', 'post', 'Post moderation', 'system');

INSERT INTO `roles` (`rol_name`, `rol_slug`, `rol_status`, `rol_description`, `rol_created_by`, `rol_updated_by`, `rol_grants`) VALUES
  ('admin', 'admin-001', 'active', 'Administrator', 'system', 'system', JSON_ARRAY()),
  ('shop', 'shop-001', 'active', 'Shop owner', 'system', 'system', JSON_ARRAY()),
  ('user', 'user-001', 'active', 'Regular buyer', 'system', 'system', JSON_ARRAY()),
  ('logistics_operator', 'logistics-operator-001', 'active', 'Read-only shipping operator', 'system', 'system', JSON_ARRAY()),
  ('shipping_manager', 'shipping-manager-001', 'active', 'Shipping manager', 'system', 'system', JSON_ARRAY());

CREATE TABLE `schema_migrations` (
  `id` VARCHAR(191) NOT NULL PRIMARY KEY,
  `filename` VARCHAR(512) NOT NULL,
  `checksum` CHAR(64) NOT NULL,
  `applied_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `schema_migrations` (`id`, `filename`, `checksum`) VALUES
  ('nodeA-20250606-001-create-carts', 'database/create_carts_table.sql', 'afed25f09cc4f3f8f0d2369f64facb044831afc06481491ad5830868ccc82425'),
  ('nodeA-20250612-001-create-product-reviews', 'database/create_product_reviews_table.sql', 'cf7ee362c3576ff6323096e5689774499dc2cc50656e1e6f5faf06a079de1373'),
  ('nodeA-20260707-001-create-wishlist-items', 'database/create_wishlist_items_table.sql', 'd7b7cc4f3528b419d6ed38d0982b256a7c757984f96c629d6a5717ecff61e4fa'),
  ('nodeA-20260713-001-add-product-risk-columns', 'database/add_risk_columns_to_products.sql', '3b7639132ce70331820cf452a307548c73eee635f8d1ed24fe6476a35f9b9243'),
  ('nodeA-20260716-001-add-product-risk-scoring-state', 'database/add_product_risk_scoring_state.sql', '09ec28d2a2daa4a33b132766274a54b5aee81b699e5270440010e3f40a5e17ff'),
  ('nodeA-20260716-002-create-product-risk-feedback', 'database/create_product_risk_feedback_table.sql', '855749e1a042c9cd3caaa31e38c465447ba589294c74fac7c9601cacba4ed363'),
  ('nodeA-20260717-001-add-public-id-to-orders', 'database/add_public_id_to_orders.sql', 'c6d4481182fdbec59600dfee89f51150632c037028cd7e223a6f62b4a7050d01'),
  ('nodeA-20260717-002-add-public-id-to-users', 'database/add_public_id_to_users.sql', 'cf864baaa2cd0b4c660fcb7011874f3149942afc6c27c26e857a0388548fad7e'),
  ('nodeA-20260717-003-add-public-id-to-chat', 'database/add_public_id_to_chat.sql', 'de9def3d42a12d2f68b73fb13ce82417dea4c24d546807b335c7c6e49e4b3604'),
  ('nodeA-20260717-004-add-public-id-to-addresses-notifications-returns', 'database/add_public_id_to_addresses_notifications_returns.sql', '9f112f07596ac9f2e661c5064cc40fb2ad3d47da1d20747ef30f820edda2d118'),
  ('nodeA-20260717-005-add-public-id-to-products', 'database/add_public_id_to_products.sql', '6d92ba384059d9955fffb7c1871324d291dd67820d485f5ad3708a6f4c4532fc'),
  ('nodeA-20260717-006-add-public-id-to-posts-comments', 'database/add_public_id_to_posts_comments.sql', '933f964d4cb299694caad0c5495978b44de475e9125c744f0b27ec773fb356db'),
  ('nodeA-20260717-007-snapshot-product-public-id-on-order-items', 'database/add_product_public_id_snapshot_to_order_items.sql', 'fbaf1e46bc695ac5c92ca03e44b90dabc2e2a32974b796028e98e501bc4ca608'),
  ('nodeA-20250625-001-create-post-reports', 'database/create_post_reports_table.sql', 'a1e886506c0e3c7c2a4593036259cce6dd98ad36f93af328fe12d40485069bd8'),
  ('nodeA-20260707-002-add-social-performance-indexes', 'database/add_social_performance_indexes.sql', '12bb818712bf41130da1a7d5445218cae20af4fdc446193cd1a3a8fdee85c57a'),
  ('nodeA-20260707-003-add-chat-message-performance-indexes', 'database/add_chat_message_performance_indexes.sql', '8715670268680c03dea7e41ce4ed78552c3eed00605c2da9d5de419d08e5f169'),
  ('nodeA-20250701-001-create-user-addresses', 'database/create_user_addresses_table.sql', 'fe1b8b68bc2f95e1f01f40569cefa84b1ad697d9f4e9d83ddb227212e4bdac07'),
  ('nodeA-app-notification-001-create-notifications', 'apps/notification/src/migrations/create_notifications_table.sql', '7efacd4474cc26353d39088c761c2090d0aba2473c5876451d43d62c2816a889');

COMMIT;
SET FOREIGN_KEY_CHECKS = 1;

