-- Migration: add_resources_roles_tables
-- Target DB: MySQL
-- Creates: resources, roles tables for RBAC

CREATE TABLE IF NOT EXISTS `resources` (
  `res_id`          INT          NOT NULL AUTO_INCREMENT,
  `res_name`        VARCHAR(255) NOT NULL,
  `res_slug`        VARCHAR(255) NOT NULL,
  `res_description` VARCHAR(255) NOT NULL DEFAULT '',
  `res_created_by`  VARCHAR(255) NOT NULL,
  `createdAt`       DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt`       DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`res_id`),
  UNIQUE KEY `UQ_resources_res_slug` (`res_slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `roles` (
  `rol_id`          INT          NOT NULL AUTO_INCREMENT,
  `rol_name`        ENUM('user','shop','admin') NOT NULL DEFAULT 'user',
  `rol_slug`        VARCHAR(255) NOT NULL,
  `rol_status`      ENUM('active','block','pending') NOT NULL DEFAULT 'active',
  `rol_description` VARCHAR(255) NOT NULL DEFAULT '',
  `rol_created_by`  VARCHAR(255) NOT NULL,
  `rol_updated_by`  VARCHAR(255) NOT NULL,
  `rol_grants`      JSON         NULL,
  `createdAt`       DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt`       DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`rol_id`),
  UNIQUE KEY `UQ_roles_rol_slug` (`rol_slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE `users`
  ADD COLUMN `role_id` INT NULL,
  ADD CONSTRAINT `FK_users_role_id` FOREIGN KEY (`role_id`) REFERENCES `roles` (`rol_id`) ON DELETE SET NULL ON UPDATE CASCADE;
