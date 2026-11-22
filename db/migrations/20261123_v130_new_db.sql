-- =====================================================================
-- Linda_ERP v1.3.0 数据库迁移：新建 linda_erp_v2，原库 linda_erp 完全保留
-- ---------------------------------------------------------------------
-- 变更点（仅作用于新库，原库结构与数据一律不动）：
--   1. categories 增加 parent_id（树形多级分类）
--   2. 新增 site_settings（站点标题 / 社团名 / Logo / 封面文案）
--   3. 全量迁移现有数据（保留自增 id，外键关系不变）
-- 执行方式（树莓派）：
--   docker exec -i linda_erp_db mariadb -uroot -p"$DB_ROOT_PASSWORD" < 本文件
-- 回滚方式：把 .env 的 DB_NAME 改回 linda_erp 并重启后端即可（原库毫发无损）
-- =====================================================================

SET NAMES utf8mb4;
SET time_zone = '+08:00';

CREATE DATABASE IF NOT EXISTS linda_erp_v2
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE linda_erp_v2;

-- ---------------------------------------------------------------------
-- 表结构（与 v1.2.6 一致 + 树形分类 + 站点配置）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username      VARCHAR(50)  NOT NULL COMMENT '登录账号',
  password_hash VARCHAR(100) NOT NULL COMMENT 'bcrypt 哈希（禁止明文）',
  name          VARCHAR(50)  NOT NULL COMMENT '姓名',
  role          VARCHAR(10)  NOT NULL DEFAULT 'member' COMMENT 'super/admin/member',
  active        TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '1 启用 / 0 停用',
  note          VARCHAR(100) NOT NULL DEFAULT '',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_username (username),
  KEY idx_users_role (role),
  CONSTRAINT chk_users_role CHECK (role IN ('super', 'admin', 'member'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '用户账号';

CREATE TABLE IF NOT EXISTS categories (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(30) NOT NULL,
  parent_id  BIGINT UNSIGNED NULL COMMENT '父分类 id；NULL 表示一级分类',
  created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_categories_parent (parent_id),
  KEY idx_categories_name (name),
  CONSTRAINT fk_categories_parent FOREIGN KEY (parent_id) REFERENCES categories (id) ON DELETE RESTRICT
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '物料分类（树形多级）';

CREATE TABLE IF NOT EXISTS materials (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(20)   NOT NULL COMMENT '档案编号，如 M-0001',
  name        VARCHAR(60)   NOT NULL,
  model       VARCHAR(80)   NOT NULL COMMENT '料号 / 型号',
  package     VARCHAR(40)   NOT NULL DEFAULT '',
  spec        VARCHAR(200)  NOT NULL DEFAULT '',
  brand       VARCHAR(40)   NOT NULL DEFAULT '',
  mode        VARCHAR(10)   NOT NULL DEFAULT 'precise' COMMENT 'simple/precise',
  qty         INT           NULL COMMENT '精确计数库存；简易模式为 NULL',
  min_qty     INT           NULL DEFAULT 0 COMMENT '最低库存预警阈值',
  status      VARCHAR(10)   NOT NULL DEFAULT 'available' COMMENT 'available/empty',
  cabinet     VARCHAR(20)   NOT NULL DEFAULT '' COMMENT '存放柜号',
  slot        VARCHAR(20)   NOT NULL DEFAULT '' COMMENT '存放格子',
  category_id BIGINT UNSIGNED NOT NULL,
  source      VARCHAR(60)   NOT NULL DEFAULT '' COMMENT '物料来源 / 所属项目',
  inbound_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '入库时间',
  image       VARCHAR(255)  NOT NULL DEFAULT '' COMMENT '图片路径或 /uploads/xxx',
  note        VARCHAR(255)  NOT NULL DEFAULT '',
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_materials_code (code),
  KEY idx_materials_name (name),
  KEY idx_materials_model (model),
  KEY idx_materials_category (category_id),
  KEY idx_materials_status (status),
  CONSTRAINT fk_materials_category FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE RESTRICT,
  CONSTRAINT chk_materials_mode CHECK (mode IN ('simple', 'precise')),
  CONSTRAINT chk_materials_status CHECK (status IN ('available', 'empty'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '物料档案';

CREATE TABLE IF NOT EXISTS stock_in_orders (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_no    VARCHAR(40)  NOT NULL COMMENT '入库单号，如 IN-20261121-xxxx',
  operator_id BIGINT UNSIGNED NOT NULL,
  note        VARCHAR(255) NOT NULL DEFAULT '',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_stock_in_order_no (order_no),
  KEY idx_stock_in_operator (operator_id),
  KEY idx_stock_in_created (created_at),
  CONSTRAINT fk_stock_in_operator FOREIGN KEY (operator_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '入库单';

CREATE TABLE IF NOT EXISTS stock_in_items (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id    BIGINT UNSIGNED NOT NULL,
  material_id BIGINT UNSIGNED NOT NULL,
  qty         INT UNSIGNED NOT NULL COMMENT '入库数量（简易模式也记录，仅流水参考）',
  PRIMARY KEY (id),
  KEY idx_stock_in_items_order (order_id),
  KEY idx_stock_in_items_material (material_id),
  CONSTRAINT fk_stock_in_items_order FOREIGN KEY (order_id) REFERENCES stock_in_orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_stock_in_items_material FOREIGN KEY (material_id) REFERENCES materials (id) ON DELETE RESTRICT
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '入库单明细';

CREATE TABLE IF NOT EXISTS stock_out_orders (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_no    VARCHAR(40)  NOT NULL COMMENT '出库单号，如 OUT-20261121-xxxx',
  type        VARCHAR(10)  NOT NULL DEFAULT 'borrow' COMMENT 'borrow/empty/adjust',
  borrower    VARCHAR(50)  NOT NULL DEFAULT '' COMMENT '领用人',
  project     VARCHAR(60)  NOT NULL DEFAULT '' COMMENT '所属项目',
  operator_id BIGINT UNSIGNED NOT NULL COMMENT '经办人',
  note        VARCHAR(255) NOT NULL DEFAULT '',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_stock_out_order_no (order_no),
  KEY idx_stock_out_operator (operator_id),
  KEY idx_stock_out_created (created_at),
  CONSTRAINT fk_stock_out_operator FOREIGN KEY (operator_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_stock_out_type CHECK (type IN ('borrow', 'empty', 'adjust'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '出库单';

CREATE TABLE IF NOT EXISTS stock_out_items (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id    BIGINT UNSIGNED NOT NULL,
  material_id BIGINT UNSIGNED NOT NULL,
  qty         INT NULL COMMENT '出库数量；简易模式可为 NULL',
  PRIMARY KEY (id),
  KEY idx_stock_out_items_order (order_id),
  KEY idx_stock_out_items_material (material_id),
  CONSTRAINT fk_stock_out_items_order FOREIGN KEY (order_id) REFERENCES stock_out_orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_stock_out_items_material FOREIGN KEY (material_id) REFERENCES materials (id) ON DELETE RESTRICT
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '出库单明细';

CREATE TABLE IF NOT EXISTS material_logs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  material_id BIGINT UNSIGNED NOT NULL,
  action      VARCHAR(10)  NOT NULL,
  qty         INT NULL,
  order_no    VARCHAR(40)  NOT NULL DEFAULT '',
  borrower    VARCHAR(50)  NOT NULL DEFAULT '',
  project     VARCHAR(60)  NOT NULL DEFAULT '',
  operator_id BIGINT UNSIGNED NULL,
  note        VARCHAR(255) NOT NULL DEFAULT '',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_logs_material (material_id),
  KEY idx_logs_action (action),
  KEY idx_logs_created (created_at),
  CONSTRAINT fk_logs_material FOREIGN KEY (material_id) REFERENCES materials (id) ON DELETE RESTRICT,
  CONSTRAINT fk_logs_operator FOREIGN KEY (operator_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT chk_logs_action CHECK (action IN ('borrow', 'restock', 'empty', 'adjust'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '物料流水日志';

CREATE TABLE IF NOT EXISTS user_visits (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NULL,
  username   VARCHAR(50) NOT NULL,
  name       VARCHAR(50) NOT NULL,
  role       VARCHAR(10) NOT NULL,
  ip         VARCHAR(64) NOT NULL DEFAULT '',
  visited_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_visits_created (visited_at),
  KEY idx_visits_user (user_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '用户访问记录';

CREATE TABLE IF NOT EXISTS site_settings (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  app_name     VARCHAR(60)  NOT NULL DEFAULT '硬件物料台账' COMMENT '左上角主标题',
  club_name    VARCHAR(60)  NOT NULL DEFAULT '校内硬件社团' COMMENT '左上角副标题',
  logo_image   VARCHAR(255) NOT NULL DEFAULT '' COMMENT '自定义 Logo 图片路径，空则用内置图标',
  cover_title  VARCHAR(80)  NOT NULL DEFAULT '硬件物料台账' COMMENT '封面主标题',
  cover_slogan VARCHAR(120) NOT NULL DEFAULT '轻量化 ERP · 回收元器件统一台账' COMMENT '封面副文案',
  cover_footer VARCHAR(255) NOT NULL DEFAULT 'Linda_ERP · 校内硬件社团' COMMENT '封面页脚',
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '站点自定义配置';

-- ---------------------------------------------------------------------
-- 数据迁移：从原库 linda_erp 全量复制（保留原 id，按外键顺序）
-- ---------------------------------------------------------------------
INSERT INTO linda_erp_v2.users
  (id, username, password_hash, name, role, active, note, created_at, updated_at)
SELECT id, username, password_hash, name, role, active, note, created_at, updated_at
FROM linda_erp.users;

INSERT INTO linda_erp_v2.categories (id, name, parent_id, created_at)
SELECT id, name, NULL, created_at FROM linda_erp.categories;

INSERT INTO linda_erp_v2.materials
  (id, code, name, model, package, spec, brand, mode, qty, min_qty, status, cabinet, slot,
   category_id, source, inbound_at, image, note, created_at, updated_at)
SELECT id, code, name, model, package, spec, brand, mode, qty, min_qty, status, cabinet, slot,
       category_id, source, inbound_at, image, note, created_at, updated_at
FROM linda_erp.materials;

INSERT INTO linda_erp_v2.stock_in_orders (id, order_no, operator_id, note, created_at)
SELECT id, order_no, operator_id, note, created_at FROM linda_erp.stock_in_orders;

INSERT INTO linda_erp_v2.stock_in_items (id, order_id, material_id, qty)
SELECT id, order_id, material_id, qty FROM linda_erp.stock_in_items;

INSERT INTO linda_erp_v2.stock_out_orders (id, order_no, type, borrower, project, operator_id, note, created_at)
SELECT id, order_no, type, borrower, project, operator_id, note, created_at FROM linda_erp.stock_out_orders;

INSERT INTO linda_erp_v2.stock_out_items (id, order_id, material_id, qty)
SELECT id, order_id, material_id, qty FROM linda_erp.stock_out_items;

INSERT INTO linda_erp_v2.material_logs
  (id, material_id, action, qty, order_no, borrower, project, operator_id, note, created_at)
SELECT id, material_id, action, qty, order_no, borrower, project, operator_id, note, created_at
FROM linda_erp.material_logs;

INSERT INTO linda_erp_v2.user_visits
  (id, user_id, username, name, role, ip, visited_at)
SELECT id, user_id, username, name, role, ip, visited_at FROM linda_erp.user_visits;

INSERT INTO linda_erp_v2.site_settings
  (id, app_name, club_name, logo_image, cover_title, cover_slogan, cover_footer)
VALUES (1, '硬件物料台账', '校内硬件社团', '',
        '硬件物料台账', '轻量化 ERP · 回收元器件统一台账', 'Linda_ERP · 校内硬件社团');

-- ---------------------------------------------------------------------
-- 修正自增起点（避免迁移后新数据与旧 id 冲突）
-- ---------------------------------------------------------------------
SET @n := (SELECT IFNULL(MAX(id), 0) + 1 FROM users);
SET @s := CONCAT('ALTER TABLE users AUTO_INCREMENT = ', @n); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @n := (SELECT IFNULL(MAX(id), 0) + 1 FROM categories);
SET @s := CONCAT('ALTER TABLE categories AUTO_INCREMENT = ', @n); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @n := (SELECT IFNULL(MAX(id), 0) + 1 FROM materials);
SET @s := CONCAT('ALTER TABLE materials AUTO_INCREMENT = ', @n); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @n := (SELECT IFNULL(MAX(id), 0) + 1 FROM stock_in_orders);
SET @s := CONCAT('ALTER TABLE stock_in_orders AUTO_INCREMENT = ', @n); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @n := (SELECT IFNULL(MAX(id), 0) + 1 FROM stock_in_items);
SET @s := CONCAT('ALTER TABLE stock_in_items AUTO_INCREMENT = ', @n); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @n := (SELECT IFNULL(MAX(id), 0) + 1 FROM stock_out_orders);
SET @s := CONCAT('ALTER TABLE stock_out_orders AUTO_INCREMENT = ', @n); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @n := (SELECT IFNULL(MAX(id), 0) + 1 FROM stock_out_items);
SET @s := CONCAT('ALTER TABLE stock_out_items AUTO_INCREMENT = ', @n); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @n := (SELECT IFNULL(MAX(id), 0) + 1 FROM material_logs);
SET @s := CONCAT('ALTER TABLE material_logs AUTO_INCREMENT = ', @n); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @n := (SELECT IFNULL(MAX(id), 0) + 1 FROM user_visits);
SET @s := CONCAT('ALTER TABLE user_visits AUTO_INCREMENT = ', @n); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @n := (SELECT IFNULL(MAX(id), 0) + 1 FROM site_settings);
SET @s := CONCAT('ALTER TABLE site_settings AUTO_INCREMENT = ', @n); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------
-- 授权：业务账号沿用原 linda_erp 账号，授予新库权限
-- ---------------------------------------------------------------------
GRANT ALL PRIVILEGES ON linda_erp_v2.* TO 'linda_erp'@'%';
FLUSH PRIVILEGES;

-- ---------------------------------------------------------------------
-- 迁移校验
-- ---------------------------------------------------------------------
SELECT 'users' AS table_name, COUNT(*) AS rows_in_v2 FROM linda_erp_v2.users
UNION ALL SELECT 'categories', COUNT(*) FROM linda_erp_v2.categories
UNION ALL SELECT 'materials', COUNT(*) FROM linda_erp_v2.materials
UNION ALL SELECT 'stock_in_orders', COUNT(*) FROM linda_erp_v2.stock_in_orders
UNION ALL SELECT 'stock_in_items', COUNT(*) FROM linda_erp_v2.stock_in_items
UNION ALL SELECT 'stock_out_orders', COUNT(*) FROM linda_erp_v2.stock_out_orders
UNION ALL SELECT 'stock_out_items', COUNT(*) FROM linda_erp_v2.stock_out_items
UNION ALL SELECT 'material_logs', COUNT(*) FROM linda_erp_v2.material_logs
UNION ALL SELECT 'user_visits', COUNT(*) FROM linda_erp_v2.user_visits
UNION ALL SELECT 'site_settings', COUNT(*) FROM linda_erp_v2.site_settings;
