# 前端对接后端说明（Linda_ERP · 已实现）

前端为原生静态 HTML/CSS/JS（`frontend/`，无需构建），**已全部切换为后端 API + MariaDB**，不再读取 `localStorage` 模拟业务数据。本文说明当前实现与维护方式。

## 1. 接口基础地址

| 场景 | 地址 | 说明 |
| --- | --- | --- |
| 生产（Nginx 8088 同源反代） | `/api` | 前端与后端同域，无需 CORS |
| 本地预览（8090） | `http://10.34.126.41:8088/api` | `config.js` 自动判断端口并指向树莓派后端 |
| 本地直连后端（开发） | `http://127.0.0.1:8000/api` | 需要在 `.env` 的 `CORS_ORIGINS` 放行前端地址 |

`frontend/js/config.js` 中的实际逻辑：

```js
ERP.config.apiBase = (function () {
  if (window.ERP_API_BASE) return window.ERP_API_BASE;
  if (window.location.protocol === 'file:') return 'http://10.34.126.41:8088/api';
  if (window.location.port === '8090') return 'http://10.34.126.41:8088/api';
  return '/api';
})();
```

## 2. JWT 登录与会话

- 登录：登录页调用 `POST /api/auth/login`（JSON：`username` / `password`）。
- 成功后把 `access_token` 与用户信息写入 `localStorage` 会话（键 `erp.v1.session`），同时写 `erp.token`。
- 所有接口由 `frontend/js/api.js` 自动添加请求头：
  ```
  Authorization: Bearer <access_token>
  ```
- 接口返回 `401` 时自动清除会话并跳回 `login.html`。
- 登录页已移除角色选择/演示账号，角色完全由后端 `users.role` 决定。

## 3. 数据层（`frontend/js/store.js`）

- `ERP.store.load()`：并发拉取物料（500 条）、分类、库存统计、最近流水、用户（管理员）并写入内存缓存。
- 页面初始化先 `await ERP.store.load()`；所有列表/详情从缓存同步读取，筛选与分页在前端完成。
- 写操作全部调用后端并刷新缓存：

| 前端调用 | 后端接口 |
| --- | --- |
| `store.upsertMaterial(payload)` | `POST /api/materials` / `PATCH /api/materials/{id}` |
| `store.setStatus(id,status)` / `markEmpty` | `PATCH /api/materials/{id}/status` |
| `store.borrow(input)` | `POST /api/stock-out`（领用） |
| `store.borrowBatch(entries, meta)` | `POST /api/stock-out`（一次提交多条明细） |
| `store.restock(id, qty)` / `createStockIn` | `POST /api/stock-in` |
| `store.addCategory / renameCategory / deleteCategory` | `/api/categories`（新增/删除仅超级管理员，管理员仅重命名） |
| `store.addUser / updateUser / deleteUser` | `/api/users` |
| `store.stockInOrders / stockInDetail` | `/api/stock-in` |
| `store.stockOutOrders / stockOutDetail` | `/api/stock-out` |
| `store.fetchMaterialLogs(id)` | `/api/materials/{id}/logs` |
| `store.visits()` | `/api/visits`（超级管理员） |

## 4. 已接入的页面

- 登录页：真实账号密码 + JWT
- 工作台：物料统计、低库存、分类占比、领用排行、最近流水、出入库趋势（基于真实日志）
- 物料总览 / 新增 / 编辑 / 详情：档案 CRUD、图片路径、历史流水
- 领用登记：单条 + 使用车批量 → 出库单，扣减库存并写日志
- 库存预警：低库存查询 + 快捷补货 → 入库单
- 分类管理：增删改、展开物料清单
- 领用日志：领用/入库/标记为空流水
- **出入库单（新增页面）**：入库单 / 出库单分页查询、新建入库单、查看单据明细
- 用户管理：三级角色、密码初始化/重置、账号保护

## 5. 上传图片（已接入新增物料页，规划多图）

后端 `POST /api/uploads`（multipart，字段 `file`，≤10MB）返回 `{url:"/uploads/xxx.png"}`，Nginx `/uploads/` 直接读取 `data/uploads`。

新增物料页已支持多图上传：前端限制 jpg/png、单张 ≤5MB、最多 5 张；上传成功后把 `/uploads/...` 相对路径以逗号分隔写入 `materials.image`，详情页按路径回显图集。后续可扩展为 `material_images` 独立表，但数据库仍只保存相对路径。

## 6. 部署与本地调试

```bash
# 生产（树莓派）
sudo bash scripts/deploy-pi.sh

# 本地前端预览（API 自动指向 10.34.126.41:8088）
node scripts/dev-server.js 8090
```

- 本地预览需要树莓派后端在线，且 `.env` 的 `CORS_ORIGINS` 包含 `http://127.0.0.1:8090`。
- 生产环境 `frontend/js/config.js` 的 `dev` 已改为 `false`，关闭开发期自动刷新。
- 登录账号请在「用户管理」中创建（超级管理员可分配管理员/普通成员；管理员只能管理普通成员）。
