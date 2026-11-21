# db · 数据库相关文件

当前阶段为纯前端演示，数据保存在浏览器 `localStorage`。后续阶段**只接入数据库，不开发独立后端服务**（由数据库/接口服务直接提供数据读写）。

## 规划

| 数据 | 前端 localStorage 键 | 数据库表（规划） |
| --- | --- | --- |
| 物料档案 | `erp.v1.data` → `materials` | `materials` |
| 物料分类 | `erp.v1.data` → `categories` | `categories` |
| 领用 / 补货 / 标记为空日志 | `erp.v1.data` → `logs` | `material_logs` |
| 用户与角色 | `erp.v1.data` → `users` | `users` |
| 成员访问记录 | `erp.v1.visits` | `user_visits` |
| 物料使用车（会话级） | `erp.v1.cart` | 可不入库，或 `cart_items` |

## 建议表结构要点

- `categories(id, name)`
- `materials(id, category_id, name, model, package, spec, brand, mode, qty, min_qty, status, cabinet, slot, source, inbound_at, image, note, created_at, updated_at)`
  - `mode`：`simple` / `precise`
  - 精确计数模式 `qty` 有效；简易模式忽略 `qty`
- `users(id, account, name, role, note, created_at)`
  - `role`：`super` / `admin` / `member`
- `material_logs(id, material_id, action, qty, borrower, borrow_at, project, operator, note, created_at)`
  - `action`：`borrow` / `restock` / `empty`
- `user_visits(id, user_id, account, name, role, visited_at)`

## 目录约定

- 本目录存放数据库 schema、初始化脚本、种子数据与备份：
  - `schema.sql`（待补充）
  - `seed.sql`（待补充）
  - `backups/`（本地备份，已被 .gitignore 忽略）
- 不在此目录生成 Node / Java / Python 等后端服务代码。
