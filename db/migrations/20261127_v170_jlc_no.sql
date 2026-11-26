-- ============================================================================
-- Linda_ERP v1.7.0：materials 表安全追加嘉立创编号字段
-- 约束：
--   1. 仅 ADD COLUMN，不修改/删除任何已有字段；
--   2. 默认空字符串，兼容已有 449 条物料，无需回填；
--   3. 执行前必须先做整库备份。
-- 执行示例：
--   mariadb -uroot -p linda_erp_v2 < db/migrations/20261127_v170_jlc_no.sql
-- ============================================================================

SET @exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'materials'
    AND COLUMN_NAME = 'jlc_no'
);

SET @sql := IF(
  @exists = 0,
  'ALTER TABLE materials ADD COLUMN jlc_no VARCHAR(64) NOT NULL DEFAULT '''' COMMENT ''嘉立创编号'' AFTER model',
  'SELECT ''materials.jlc_no already exists'' AS message'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SHOW COLUMNS FROM materials LIKE 'jlc_no';
