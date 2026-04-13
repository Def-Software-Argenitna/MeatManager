-- Promociones por kilo para Ventas
-- Ejemplo: 2.000 kg de un articulo por precio promo fijo.

CREATE TABLE IF NOT EXISTS promotions (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id         BIGINT NOT NULL DEFAULT 1,
    product_id        INT NULL,
    product_name      VARCHAR(150) NOT NULL,
    min_qty_kg        DECIMAL(12,3) NOT NULL,
    promo_total_price DECIMAL(12,2) NOT NULL,
    stock_mode        VARCHAR(20) NOT NULL DEFAULT 'all_stock',
    stock_cap_kg_limit DECIMAL(12,3) NULL,
    end_condition     VARCHAR(20) NOT NULL DEFAULT 'none',
    sold_kg_limit     DECIMAL(12,3) NULL,
    end_date          DATETIME NULL,
    used_kg           DECIMAL(12,3) NOT NULL DEFAULT 0,
    active            TINYINT(1) NOT NULL DEFAULT 1,
    notes             VARCHAR(255),
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_promotions_tenant_id (tenant_id, id),
    INDEX idx_promotions_tenant (tenant_id),
    INDEX idx_promotions_tenant_product (tenant_id, product_id),
    INDEX idx_promotions_tenant_name (tenant_id, product_name)
);
