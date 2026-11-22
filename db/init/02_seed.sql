-- =====================================================================
-- Linda_ERP 初始基础数据 v1.3.0（库名 linda_erp_v2）
-- 仅包含基础字典：物料分类 + 站点配置默认值
-- 管理员账号仍使用 bcrypt 哈希，由 CLI 初始化：
--   docker compose exec -T backend \
--     python -m app.cli create-admin --username superadmin --name 周明 \
--     --role super --password-stdin
-- =====================================================================

SET NAMES utf8mb4;
SET time_zone = '+08:00';

CREATE DATABASE IF NOT EXISTS linda_erp_v2
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE linda_erp_v2;

-- 一级分类（已存在则跳过；树形子分类由超级管理员在「分类管理」页右键创建）
INSERT INTO categories (name)
SELECT name FROM (
  SELECT '基础元件' AS name
  UNION ALL SELECT '主控模块'
  UNION ALL SELECT '传感器模块'
  UNION ALL SELECT '显示与交互'
  UNION ALL SELECT '无线通信'
  UNION ALL SELECT '电源与电池'
  UNION ALL SELECT '驱动与执行器'
  UNION ALL SELECT '连接与耗材'
  UNION ALL SELECT '工具与辅料'
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM categories c WHERE c.name = seed.name AND c.parent_id IS NULL);

-- 站点配置默认值（单行配置，id 固定 1）
INSERT INTO site_settings
  (id, app_name, club_name, logo_image, cover_title, cover_slogan, cover_footer)
SELECT 1, '硬件物料台账', '校内硬件社团', '',
       '硬件物料台账', '轻量化 ERP · 回收元器件统一台账', 'Linda_ERP · 校内硬件社团'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM site_settings WHERE id = 1);
