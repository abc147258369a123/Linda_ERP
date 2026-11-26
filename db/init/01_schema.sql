-- =====================================================================
-- Linda_ERP 数据库结构 v1.3.0（MariaDB 10.11 / InnoDB / utf8mb4）
-- ---------------------------------------------------------------------
-- v1.3.0 变更：
--   1. categories 增加 parent_id（树形多级分类，NULL 为一级分类）
--   2. 新增 site_settings（站点标题 / 社团名 / Logo / 封面文案）
-- 说明：库名使用迁移后的 linda_erp_v2；已有环境请执行
--       db/migrations/20261123_v130_new_db.sql 完成数据迁移（原库保留不动）
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
  jlc_no      VARCHAR(64)   NOT NULL DEFAULT '' COMMENT '嘉立创编号',
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

CREATE TABLE IF NOT EXISTS ui_settings (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  page       VARCHAR(30)  NOT NULL COMMENT '页面标识，如 login',
  field_key  VARCHAR(60)  NOT NULL COMMENT '文案字段名，如 login_title',
  label      VARCHAR(60)  NOT NULL DEFAULT '' COMMENT '后台展示名称',
  value      VARCHAR(500) NOT NULL DEFAULT '' COMMENT '文案内容',
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ui_settings_page_key (page, field_key),
  KEY idx_ui_settings_page (page)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '页面可编辑文案配置';