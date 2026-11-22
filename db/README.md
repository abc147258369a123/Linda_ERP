# db · 数据库相关文件（MariaDB 10.11）

后端已实现，数据库使用 **MariaDB 10.11**，不使用 SQL Server / Oracle / Elasticsearch。

> v1.3.0 起生产库为 **`linda_erp_v2`**（树形分类 + 站点配置）；原库 `linda_erp` 保留原样用于回滚，
> 迁移脚本见 `migrations/20261123_v130_new_db.sql`，说明见 `docs/v1.3.0-迭代说明与数据库迁移.md`。

## 目录

| 文件 | 说明 |
| --- | --- |
| `init/01_schema.sql` | 建表 SQL（v1.3.0：用户、树形分类、物料、入库单、出库单、流水、访问记录、站点配置） |
| `init/02_seed.sql` | 初始基础数据（9 个一级物料分类 + 站点配置默认值） |
| `migrations/` | 版本迁移脚本（新库创建 + 数据迁移 / 结构变更） |
| `backups/` | 本地备份目录（已 gitignore） |

## 自动初始化

`db/init/` 会挂载到 MariaDB 容器的 `/docker-entrypoint-initdb.d`，**仅在 `./data/mariadb` 首次为空时执行**。修改 SQL 后如需重建：

```bash
docker compose down
sudo rm -rf data/mariadb
docker compose up -d
```

> 管理员账号不写死在 SQL 中，使用 `python -m app.cli create-admin` 以 bcrypt 哈希创建，避免明文密码。

## 表结构要点

- `users`：`role` = `super` / `admin` / `member`；`password_hash` 为 bcrypt（禁止明文）
- `materials`：`mode` = `simple`（只记录有货/空）或 `precise`（记录 `qty`、`min_qty`）
- `stock_in_orders` / `stock_in_items`：入库单
- `stock_out_orders` / `stock_out_items`：出库单（`borrow` / `empty` / `adjust`）
- `material_logs`：只追加的物料流水（`borrow` / `restock` / `empty` / `adjust`）
- `user_visits`：登录访问记录（超级管理员通知面板）

## 备份

```bash
docker compose exec -T mariadb mariadb-dump \
  -uroot -p"$DB_ROOT_PASSWORD" --single-transaction linda_erp \
  > data/backups/linda_erp_$(date +%F).sql
```
