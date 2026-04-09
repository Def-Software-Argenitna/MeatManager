-- ============================================================
-- MIGRACIÓN: product_prices como tabla canónica de historial
-- Fecha: 2026-04-08
-- Propósito:
--   Reemplazar `prices` (tabla operativa legacy) por `product_prices`,
--   que es el historial de precios correctamente vinculado a products.id.
--
-- Estrategia de 3 fases:
--   Fase 1 (este archivo): crear product_prices + backfill desde prices
--   Fase 2 (server.js):    dual-write → toda escritura va a product_prices
--                          además de mantener prices durante la transición
--   Fase 3 (futura):       retirar prices cuando no queden consumidores
--
-- IMPORTANTE: ejecutar cuando el servidor esté sin tráfico activo
-- o en una ventana de mantenimiento.
-- ============================================================

-- ── Fase 1a: Crear tabla product_prices ──────────────────────────────────

CREATE TABLE IF NOT EXISTS product_prices (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id      BIGINT NOT NULL,
    product_id     INT    NOT NULL,              -- FK → products.id (nunca NULL)
    price          DECIMAL(12,2) NOT NULL DEFAULT 0,
    plu            VARCHAR(20)  NULL,
    source         VARCHAR(50)  NULL,            -- 'manual','import','backfill', etc.
    effective_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Índice primario de consulta: último precio de un producto para un tenant
    INDEX idx_pp_tenant_product_eff (tenant_id, product_id, effective_at),
    -- Índice para buscar por PLU dentro del tenant
    INDEX idx_pp_tenant_plu         (tenant_id, plu),
    -- Restricción de tenant-scope
    UNIQUE KEY uniq_pp_tenant_id    (tenant_id, id),
    -- FK real contra la tabla maestra
    CONSTRAINT product_prices_product_fk
        FOREIGN KEY (tenant_id, product_id)
        REFERENCES products (tenant_id, id)
        ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ── Fase 1b: Backfill desde prices ───────────────────────────────────────
-- Solo inserta filas que aún no existen en product_prices para un mismo
-- (tenant_id, product_id, precio, fecha).  Es idempotente: se puede
-- ejecutar más de una vez sin duplicar datos.

INSERT INTO product_prices
    (tenant_id, product_id, price, plu, source, effective_at, created_at)
SELECT
    pr.tenant_id,
    pr.product_ref_id                            AS product_id,
    COALESCE(pr.price, 0)                        AS price,
    NULLIF(TRIM(COALESCE(pr.plu, '')), '')       AS plu,
    'backfill_from_prices'                       AS source,
    COALESCE(pr.updated_at, NOW())               AS effective_at,
    NOW()                                        AS created_at
FROM prices pr
-- Solo filas ya reconciliadas con un product_ref_id válido
WHERE pr.product_ref_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM product_prices pp
     WHERE pp.tenant_id  = pr.tenant_id
       AND pp.product_id = pr.product_ref_id
       AND pp.source     = 'backfill_from_prices'
  );


-- ── Fase 1c: Backfill desde products.current_price ───────────────────────
-- Para productos que tienen current_price pero que no tienen ningún registro
-- en product_prices todavía (por ejemplo, fueron creados directamente sin
-- pasar por prices).

INSERT INTO product_prices
    (tenant_id, product_id, price, plu, source, effective_at, created_at)
SELECT
    p.tenant_id,
    p.id                                         AS product_id,
    p.current_price                              AS price,
    NULLIF(TRIM(COALESCE(p.plu, '')), '')        AS plu,
    'backfill_from_products'                     AS source,
    COALESCE(p.updated_at, NOW())                AS effective_at,
    NOW()                                        AS created_at
FROM products p
WHERE COALESCE(p.current_price, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM product_prices pp
     WHERE pp.tenant_id  = p.tenant_id
       AND pp.product_id = p.id
  );


-- ── Comentario sobre Fase 3 (retiro de prices) ───────────────────────────
-- Cuando todas las APIs y clientes lean de product_prices / products, ejecutar:
--
--   ALTER TABLE prices DROP FOREIGN KEY prices_product_ref_fk;
--   DROP TABLE prices;
--
-- Y en Dexie (db.js) incrementar la versión con prices: null para eliminarla.
-- No ejecutar este bloque hasta confirmar que ningun consumidor queda.
