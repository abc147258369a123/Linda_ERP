-- =====================================================================
-- Linda_ERP v1.4.0 数据库迁移：新增页面文案配置表 ui_settings
-- ---------------------------------------------------------------------
-- 说明：
--   * 仅新增表 + 默认文案行，不修改、不删除任何现有表结构或现有数据
--   * 现有库 linda_erp_v2 与历史库 linda_erp 均保留；259 条物料数据不受影响
--   * 执行：docker exec -i linda_erp_db mariadb -uroot -p"$DB_ROOT_PASSWORD" < 本文件
-- =====================================================================

SET NAMES utf8mb4;
SET time_zone = '+08:00';
USE linda_erp_v2;

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

-- 登录页默认文案（仅当对应字段不存在时插入，绝不覆盖已有值）
INSERT INTO ui_settings (page, field_key, label, value)
SELECT 'login', seed.field_key, seed.label, seed.value FROM (
  SELECT 'login_title' AS field_key, '主标题' AS label, '硬件物料台账' AS value
  UNION ALL SELECT 'login_subtitle', '副标题', '校内硬件社团 · 轻量化 ERP'
  UNION ALL SELECT 'login_point1_title', '介绍 1 · 标题', '双模式库存'
  UNION ALL SELECT 'login_point1_desc', '介绍 1 · 描述', '海量小件记状态，稀缺器件记数量'
  UNION ALL SELECT 'login_point2_title', '介绍 2 · 标题', '领用全留痕'
  UNION ALL SELECT 'login_point2_desc', '介绍 2 · 描述', '每次领用自动生成日志，永久可查'
  UNION ALL SELECT 'login_point3_title', '介绍 3 · 标题', '轻量可离线'
  UNION ALL SELECT 'login_point3_desc', '介绍 3 · 描述', '纯静态页面，树莓派本地部署'
  UNION ALL SELECT 'login_card_title', '登录卡片标题', '账号登录'
  UNION ALL SELECT 'login_card_desc', '登录卡片说明', '使用社团账号登录，角色与权限由后端统一校验'
  UNION ALL SELECT 'login_label_account', '账号标签', '账号'
  UNION ALL SELECT 'login_placeholder_account', '账号输入提示', '请输入社团账号'
  UNION ALL SELECT 'login_label_password', '密码标签', '密码'
  UNION ALL SELECT 'login_placeholder_password', '密码输入提示', '请输入密码'
  UNION ALL SELECT 'login_btn_text', '登录按钮文字', '登 录'
  UNION ALL SELECT 'login_note', '卡片底部说明', '账号由超级管理员在「用户管理」中创建；登录成功后使用 JWT 令牌访问后端接口，页面数据全部来自 MariaDB，不再使用浏览器模拟数据。'
  UNION ALL SELECT 'login_footer', '页脚文字', 'HARDWARE INVENTORY'
  UNION ALL SELECT 'login_session_text', '已登录提示', '当前已登录，可直接进入系统'
) AS seed
WHERE NOT EXISTS (
  SELECT 1 FROM ui_settings u WHERE u.page = 'login' AND u.field_key = seed.field_key
);

-- 校验
SELECT CONCAT('ui_settings_rows=', COUNT(*)) AS check_result FROM ui_settings WHERE page = 'login';
SELECT CONCAT('materials=', COUNT(*)) AS check_result FROM materials;
