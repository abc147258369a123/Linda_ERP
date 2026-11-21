-- =====================================================================
-- Linda_ERP 初始基础数据
-- 只包含基础字典（物料分类）；管理员账号使用 bcrypt 哈希，由 CLI 初始化：
--   docker compose exec -T backend \
--     python -m app.cli create-admin --username superadmin --name 周明 \
--     --role super --password-stdin
-- =====================================================================

SET NAMES utf8mb4;
SET time_zone = '+08:00';

CREATE DATABASE IF NOT EXISTS linda_erp
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE linda_erp;

INSERT INTO categories (name) VALUES
  ('基础元件'),
  ('主控模块'),
  ('传感器模块'),
  ('显示与交互'),
  ('无线通信'),
  ('电源与电池'),
  ('驱动与执行器'),
  ('连接与耗材'),
  ('工具与辅料')
ON DUPLICATE KEY UPDATE name = VALUES(name);
