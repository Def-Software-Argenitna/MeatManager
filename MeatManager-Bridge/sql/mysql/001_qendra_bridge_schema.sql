CREATE TABLE IF NOT EXISTS qendra_bridge_devices (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    device_id VARCHAR(80) NOT NULL,
    bridge_name VARCHAR(120) NOT NULL,
    site_name VARCHAR(120) NULL,
    last_seen_at DATETIME NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'online',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_bridge_device (device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS qendra_bridge_sync_state (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    device_id VARCHAR(80) NOT NULL,
    last_product_sync_at DATETIME NULL,
    last_ticket_sync_at DATETIME NULL,
    last_success_at DATETIME NULL,
    last_error_at DATETIME NULL,
    last_error_message TEXT NULL,
    cursor_product VARCHAR(191) NULL,
    cursor_ticket VARCHAR(191) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_sync_state_device (device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS qendra_bridge_product_map (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    device_id VARCHAR(80) NOT NULL,
    tenant_id BIGINT UNSIGNED NOT NULL,
    product_id BIGINT UNSIGNED NOT NULL,
    firebird_plu_id VARCHAR(40) NOT NULL,
    firebird_section_id VARCHAR(40) NULL,
    fingerprint VARCHAR(80) NOT NULL,
    last_source_update DATETIME NULL,
    first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    synced_at DATETIME NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_bridge_product_device_plu (device_id, firebird_plu_id),
    UNIQUE KEY uniq_bridge_product_tenant_product (tenant_id, product_id),
    KEY idx_bridge_product_fingerprint (fingerprint)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS qendra_bridge_ticket_map (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    device_id VARCHAR(80) NOT NULL,
    tenant_id BIGINT UNSIGNED NOT NULL,
    branch_id BIGINT UNSIGNED NULL,
    firebird_ticket_id VARCHAR(80) NOT NULL,
    external_ticket_id VARCHAR(120) NOT NULL,
    ticket_barcode VARCHAR(120) NOT NULL,
    fingerprint VARCHAR(120) NOT NULL,
    mysql_venta_id BIGINT UNSIGNED NULL,
    total_amount DECIMAL(12,2) NULL,
    total_weight DECIMAL(12,3) NULL,
    item_count INT UNSIGNED NOT NULL DEFAULT 0,
    first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    synced_at DATETIME NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_bridge_ticket_device_ticket (device_id, firebird_ticket_id),
    UNIQUE KEY uniq_bridge_ticket_external (external_ticket_id),
    UNIQUE KEY uniq_bridge_ticket_barcode (ticket_barcode),
    KEY idx_bridge_ticket_fingerprint (fingerprint),
    KEY idx_bridge_ticket_mysql_venta (mysql_venta_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS qendra_bridge_sync_log (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    device_id VARCHAR(80) NOT NULL,
    direction VARCHAR(20) NOT NULL,
    entity_type VARCHAR(40) NOT NULL,
    entity_key VARCHAR(120) NOT NULL,
    status VARCHAR(20) NOT NULL,
    message TEXT NULL,
    payload_json JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_bridge_sync_log_device_created (device_id, created_at),
    KEY idx_bridge_sync_log_entity (entity_type, entity_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Existing operational tables are expected to already exist:
-- products, ventas, ventas_items, stock
-- The bridge runtime adds missing columns if needed:
-- ventas.qendra_ticket_id, ventas.ticket_barcode, ventas.bridge_device_id, ventas.bridge_synced_at
-- products.qendra_plu_id, products.qendra_fingerprint, products.qendra_synced_at
