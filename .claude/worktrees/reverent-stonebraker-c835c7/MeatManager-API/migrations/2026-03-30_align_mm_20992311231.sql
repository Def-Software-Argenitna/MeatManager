USE `mm_20992311231`;

DROP PROCEDURE IF EXISTS `add_column_if_missing`;
DROP PROCEDURE IF EXISTS `add_index_if_missing`;

DELIMITER $$

CREATE PROCEDURE `add_column_if_missing`(
    IN p_table VARCHAR(64),
    IN p_column VARCHAR(64),
    IN p_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table
          AND COLUMN_NAME = p_column
    ) THEN
        SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition);
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END$$

CREATE PROCEDURE `add_index_if_missing`(
    IN p_table VARCHAR(64),
    IN p_index VARCHAR(64),
    IN p_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table
          AND INDEX_NAME = p_index
    ) THEN
        SET @sql = CONCAT('CREATE INDEX `', p_index, '` ON `', p_table, '` ', p_definition);
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END$$

DELIMITER ;

-- ── clients ───────────────────────────────────────────────────────────────
CALL add_column_if_missing('clients', 'first_name', 'VARCHAR(100) NULL AFTER `name`');
CALL add_column_if_missing('clients', 'last_name', 'VARCHAR(100) NULL AFTER `first_name`');
CALL add_column_if_missing('clients', 'email1', 'VARCHAR(150) NULL AFTER `email`');
CALL add_column_if_missing('clients', 'email2', 'VARCHAR(150) NULL AFTER `email1`');
CALL add_column_if_missing('clients', 'street', 'VARCHAR(150) NULL AFTER `address`');
CALL add_column_if_missing('clients', 'street_number', 'VARCHAR(20) NULL AFTER `street`');
CALL add_column_if_missing('clients', 'zip_code', 'VARCHAR(20) NULL AFTER `street_number`');
CALL add_column_if_missing('clients', 'city', 'VARCHAR(100) NULL AFTER `zip_code`');
CALL add_column_if_missing('clients', 'has_current_account', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER `balance`');
CALL add_column_if_missing('clients', 'has_initial_balance', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER `has_current_account`');

UPDATE `clients`
SET
    `first_name` = COALESCE(NULLIF(`first_name`, ''), `name`),
    `last_name` = COALESCE(`last_name`, ''),
    `email1` = COALESCE(NULLIF(`email1`, ''), `email`),
    `email2` = COALESCE(`email2`, ''),
    `street` = COALESCE(NULLIF(`street`, ''), `address`),
    `street_number` = COALESCE(`street_number`, ''),
    `zip_code` = COALESCE(`zip_code`, ''),
    `city` = COALESCE(`city`, ''),
    `has_current_account` = COALESCE(`has_current_account`, 1),
    `has_initial_balance` = CASE
        WHEN `has_initial_balance` IS NOT NULL THEN `has_initial_balance`
        WHEN COALESCE(`balance`, 0) <> 0 THEN 1
        ELSE 0
    END;

-- ── purchase_items ────────────────────────────────────────────────────────
CALL add_column_if_missing('purchase_items', 'usage', 'VARCHAR(50) NULL AFTER `species`');
UPDATE `purchase_items` SET `usage` = COALESCE(`usage`, 'venta');

-- ── stock ─────────────────────────────────────────────────────────────────
CALL add_column_if_missing('stock', 'reference', 'VARCHAR(100) NULL AFTER `category_id`');

-- ── ventas ────────────────────────────────────────────────────────────────
CALL add_column_if_missing('ventas', 'clientId', 'INT NULL AFTER `client_id`');
CALL add_column_if_missing('ventas', 'payment_breakdown', 'LONGTEXT NULL AFTER `payment_method_id`');
CALL add_column_if_missing('ventas', 'receipt_number', 'INT NULL AFTER `clientId`');
CALL add_column_if_missing('ventas', 'receipt_code', 'VARCHAR(32) NULL AFTER `receipt_number`');
UPDATE `ventas` SET `clientId` = COALESCE(`clientId`, `client_id`);

-- ── compras_items ─────────────────────────────────────────────────────────
CALL add_column_if_missing('compras_items', 'destination', 'VARCHAR(50) NULL AFTER `subtotal`');
UPDATE `compras_items` SET `destination` = COALESCE(`destination`, 'venta');

-- ── caja_movimientos ──────────────────────────────────────────────────────
CALL add_column_if_missing('caja_movimientos', 'receipt_number', 'INT NULL AFTER `date`');
CALL add_column_if_missing('caja_movimientos', 'receipt_code', 'VARCHAR(32) NULL AFTER `receipt_number`');

-- ── settings defaults ─────────────────────────────────────────────────────
INSERT INTO `settings` (`key`, `value`)
SELECT 'branch_code', '1' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'branch_code');

INSERT INTO `settings` (`key`, `value`)
SELECT 'ticket_delete_authorization_code', '' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'ticket_delete_authorization_code');

INSERT INTO `settings` (`key`, `value`)
SELECT 'sale_receipt_counter', '0' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'sale_receipt_counter');

INSERT INTO `settings` (`key`, `value`)
SELECT 'collection_receipt_counter', '0' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'collection_receipt_counter');

-- ── deleted_sales_history ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `deleted_sales_history` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `sale_id` INT NULL,
    `receipt_number` INT NULL,
    `receipt_code` VARCHAR(32) NULL,
    `sale_date` DATETIME NULL,
    `deleted_at` DATETIME NULL,
    `deleted_by_user_id` INT NULL,
    `deleted_by_username` VARCHAR(100) NULL,
    `payment_method` VARCHAR(100) NULL,
    `clientId` INT NULL,
    `total` DECIMAL(12,2) NULL,
    `source` VARCHAR(50) NULL,
    `authorization_verified` TINYINT(1) NOT NULL DEFAULT 0,
    `sale_snapshot` LONGTEXT NULL,
    `items_snapshot` LONGTEXT NULL
);

-- ── branch_stock_snapshots ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `branch_stock_snapshots` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `branch_code` VARCHAR(20) NULL,
    `branch_name` VARCHAR(150) NULL,
    `snapshot_at` DATETIME NULL,
    `imported_at` DATETIME NULL
);

-- ── indexes útiles ────────────────────────────────────────────────────────
CALL add_index_if_missing('ventas', 'idx_ventas_receipt_number', '(`receipt_number`)');
CALL add_index_if_missing('ventas', 'idx_ventas_receipt_code', '(`receipt_code`)');
CALL add_index_if_missing('ventas', 'idx_ventas_clientId', '(`clientId`)');
CALL add_index_if_missing('clients', 'idx_clients_has_cc', '(`has_current_account`)');
CALL add_index_if_missing('deleted_sales_history', 'idx_deleted_at', '(`deleted_at`)');
CALL add_index_if_missing('deleted_sales_history', 'idx_sale_id', '(`sale_id`)');
CALL add_index_if_missing('deleted_sales_history', 'idx_receipt_code', '(`receipt_code`)');
CALL add_index_if_missing('branch_stock_snapshots', 'idx_branch_code', '(`branch_code`)');
CALL add_index_if_missing('branch_stock_snapshots', 'idx_snapshot_at', '(`snapshot_at`)');

DROP PROCEDURE IF EXISTS `add_column_if_missing`;
DROP PROCEDURE IF EXISTS `add_index_if_missing`;
