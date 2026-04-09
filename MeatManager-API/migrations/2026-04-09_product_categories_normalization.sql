-- Normaliza categorías de productos:
-- 1) crea product_categories
-- 2) agrega products.category_id
-- 3) migra products.category (texto) -> FK

CREATE TABLE IF NOT EXISTS product_categories (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id   BIGINT NOT NULL DEFAULT 1,
    code        VARCHAR(100) NOT NULL,
    name        VARCHAR(120) NOT NULL,
    active      TINYINT(1) DEFAULT 1,
    synced      TINYINT(1) DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_product_categories_tenant_id (tenant_id, id),
    UNIQUE KEY uniq_product_categories_tenant_code (tenant_id, code),
    INDEX idx_product_categories_tenant (tenant_id)
);

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS category_id INT NULL AFTER name;

ALTER TABLE products
    ADD INDEX IF NOT EXISTS idx_products_tenant_category (tenant_id, category_id);

INSERT INTO product_categories (tenant_id, code, name, active, synced, created_at, updated_at)
SELECT
    src.tenant_id,
    src.code,
    src.name,
    1,
    0,
    NOW(),
    NOW()
FROM (
    SELECT p.tenant_id, LOWER(TRIM(BOTH '_' FROM REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(p.category, ''), ' ', '_'), '-', '_'), '/', '_'), '__', '_'))) AS code, NULLIF(TRIM(COALESCE(p.category, '')), '') AS name
    FROM products p
    WHERE NULLIF(TRIM(COALESCE(p.category, '')), '') IS NOT NULL
) src
LEFT JOIN product_categories pc
  ON pc.tenant_id = src.tenant_id
 AND pc.code = src.code
WHERE src.code <> ''
  AND src.name IS NOT NULL
  AND pc.id IS NULL;

INSERT IGNORE INTO product_categories (tenant_id, code, name, active, synced)
SELECT tenant_id, 'vaca', 'Vaca', 1, 0 FROM (SELECT DISTINCT tenant_id FROM products) t;
INSERT IGNORE INTO product_categories (tenant_id, code, name, active, synced)
SELECT tenant_id, 'cerdo', 'Cerdo', 1, 0 FROM (SELECT DISTINCT tenant_id FROM products) t;
INSERT IGNORE INTO product_categories (tenant_id, code, name, active, synced)
SELECT tenant_id, 'pollo', 'Pollo', 1, 0 FROM (SELECT DISTINCT tenant_id FROM products) t;
INSERT IGNORE INTO product_categories (tenant_id, code, name, active, synced)
SELECT tenant_id, 'pescado', 'Pescado', 1, 0 FROM (SELECT DISTINCT tenant_id FROM products) t;
INSERT IGNORE INTO product_categories (tenant_id, code, name, active, synced)
SELECT tenant_id, 'pre_elaborados', 'Pre-elaborados', 1, 0 FROM (SELECT DISTINCT tenant_id FROM products) t;
INSERT IGNORE INTO product_categories (tenant_id, code, name, active, synced)
SELECT tenant_id, 'almacen', 'Almacen', 1, 0 FROM (SELECT DISTINCT tenant_id FROM products) t;
INSERT IGNORE INTO product_categories (tenant_id, code, name, active, synced)
SELECT tenant_id, 'limpieza', 'Limpieza', 1, 0 FROM (SELECT DISTINCT tenant_id FROM products) t;
INSERT IGNORE INTO product_categories (tenant_id, code, name, active, synced)
SELECT tenant_id, 'bebidas', 'Bebidas', 1, 0 FROM (SELECT DISTINCT tenant_id FROM products) t;
INSERT IGNORE INTO product_categories (tenant_id, code, name, active, synced)
SELECT tenant_id, 'insumo', 'Insumo General', 1, 0 FROM (SELECT DISTINCT tenant_id FROM products) t;
INSERT IGNORE INTO product_categories (tenant_id, code, name, active, synced)
SELECT tenant_id, 'otros', 'Otros', 1, 0 FROM (SELECT DISTINCT tenant_id FROM products) t;

UPDATE products p
JOIN product_categories pc
  ON pc.tenant_id = p.tenant_id
 AND pc.code = LOWER(TRIM(BOTH '_' FROM REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(p.category, ''), ' ', '_'), '-', '_'), '/', '_'), '__', '_')))
SET p.category_id = pc.id
WHERE p.category_id IS NULL
  AND NULLIF(TRIM(COALESCE(p.category, '')), '') IS NOT NULL;

UPDATE products p
JOIN product_categories pc
  ON pc.tenant_id = p.tenant_id
 AND pc.id = p.category_id
SET p.category = pc.code;

ALTER TABLE products
    ADD CONSTRAINT products_category_fk
    FOREIGN KEY (tenant_id, category_id)
    REFERENCES product_categories (tenant_id, id)
    ON DELETE SET NULL;
