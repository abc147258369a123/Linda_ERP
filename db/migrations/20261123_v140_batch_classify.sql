-- =====================================================================
-- v1.4.0 批量归类：现有全部 0603 封装电阻 / 电容 → 对应三级子分类
-- ---------------------------------------------------------------------
-- 目标结构（已由超级管理员在「分类管理」页建好，此处仅引用其 id）：
--   电阻(14) → 贴片电阻(25) → 0603(26)
--   电容(15) → 贴片电容(21) → 0603(22)
-- 说明：仅更新 materials.category_id 绑定关系，不新增/删除任何物料，
--       259 条物料的其它字段（编号/名称/型号/库存/图片等）全部保持不变。
-- 执行前务必已完成 mysqldump 备份。
-- =====================================================================

SET NAMES utf8mb4;
SET time_zone = '+08:00';
USE linda_erp_v2;

-- 执行前快照
SELECT 'BEFORE' AS stage, category_id, COUNT(*) AS cnt
FROM materials WHERE category_id IN (14, 15, 22, 26) GROUP BY category_id ORDER BY category_id;

START TRANSACTION;

-- 电阻（当前一级分类 14）中封装/型号为 0603 的全部物料 → 电阻/贴片电阻/0603(26)
UPDATE materials
SET category_id = 26
WHERE category_id = 14
  AND (package LIKE '%0603%' OR model LIKE '0603%');

-- 电容（当前一级分类 15）中封装/型号为 0603 的全部物料 → 电容/贴片电容/0603(22)
UPDATE materials
SET category_id = 22
WHERE category_id = 15
  AND (package LIKE '%0603%' OR model LIKE '0603%');

COMMIT;

-- 执行后快照 + 校验
SELECT 'AFTER' AS stage, category_id, COUNT(*) AS cnt
FROM materials WHERE category_id IN (14, 15, 22, 26) GROUP BY category_id ORDER BY category_id;

SELECT CONCAT('total_materials=', COUNT(*)) AS check_result FROM materials;
SELECT CONCAT('resistor_0603=', COUNT(*)) AS check_result FROM materials WHERE category_id = 26;
SELECT CONCAT('capacitor_0603=', COUNT(*)) AS check_result FROM materials WHERE category_id = 22;
SELECT CONCAT('still_at_top_level=', COUNT(*)) AS check_result FROM materials WHERE category_id IN (14, 15);
