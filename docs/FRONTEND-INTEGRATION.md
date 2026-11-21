# 前端对接后端说明（Linda_ERP）

前端仍为原生静态 HTML（`frontend/`，无需构建）。本文说明把当前 `localStorage` 演示数据切换为后端 API 的最小改动方式。

## 1. 接口基础地址

| 场景 | 地址 | 说明 |
| --- | --- | --- |
| 生产（Nginx 同源反代） | `/api` | 前端与后端同域，无需 CORS |
| 本地直连后端（开发） | `http://127.0.0.1:8000/api` | 需在 `.env` 的 `CORS_ORIGINS` 放行前端地址 |

示例（建议添加到 `frontend/js/config.js`）：

```js
ERP.config.apiBase = '/api';                // 生产
// ERP.config.apiBase = 'http://127.0.0.1:8000/api';  // 本地联调
ERP.config.useApi = true;                   // false 时继续走 localStorage 演示
```

## 2. 登录与会话

1. `POST /api/auth/login`
   ```json
   { "username": "admin", "password": "******" }
   ```
2. 返回 `access_token`，保存到 `localStorage`（建议键 `erp.token`）：
   ```js
   localStorage.setItem('erp.token', data.access_token);
   ERP.auth.set({ account: data.user.username, role: data.user.role, name: data.user.name, loginAt: ... });
   ```
3. 之后所有请求带请求头：
   ```
   Authorization: Bearer <access_token>
   ```
4. 收到 `401` 时清除 token 并跳回 `login.html`；`403` 显示“权限不足”。

> 前端角色判断可继续使用 `ERP.auth.rank()/isAdmin()/isSuper()`，后端已做同等校验。

## 3. 数据层替换方式（`frontend/js/store.js`）

后端接口与现有前端调用基本一一对应，把 `store.js` 中的 localStorage 读写逐步替换为 `fetch` 即可；页面逻辑无需改动。

| 前端现有方法 | 后端接口 |
| --- | --- |
| `store.materials()` / `listMaterials(filters)` | `GET /api/materials?q=&mode=&status=&category_id=&page=&page_size=` |
| `store.getMaterial(id)` | `GET /api/materials/{id}` |
| `store.upsertMaterial(payload)` | 新增 `POST /api/materials`；编辑 `PATCH /api/materials/{id}` |
| `store.setStatus(id,status)` | `PATCH /api/materials/{id}/status` |
| `store.categories()` | `GET /api/categories`（含 `material_count`） |
| `store.addCategory / renameCategory / deleteCategory` | `POST /api/categories`、`PATCH /api/categories/{id}`、`DELETE /api/categories/{id}` |
| `store.borrow(input)` | `POST /api/stock-out`（`type=borrow`，精确计数自动扣库存/置空） |
| `store.restock(id, qty)` | `POST /api/stock-in`（`items:[{material_id, qty}]`） |
| `store.markEmpty(id)` | `PATCH /api/materials/{id}/status` 或 `POST /api/stock-out`（`type=empty`，管理员） |
| `store.logs(filters)` | `GET /api/inventory/logs?q=&action=&category_id=&from=&to=&page=&page_size=` |
| `store.warnings()` | `GET /api/inventory/warnings` |
| `store.stats()` | `GET /api/inventory/stats` |
| `store.users()` / 用户管理 | `GET/POST/PATCH/DELETE /api/users` |
| `store.addVisit()` / 访问记录 | 登录时后端自动记录；超管 `GET /api/visits` |
| 物料图片上传 | `POST /api/uploads`（multipart，字段名 `file`），返回 `{url:"/uploads/xxx.png"}` |

> 使用车（`erp.v1.cart`）属于前端会话数据，可保留在 localStorage；批量提交时循环调用 `POST /api/stock-out` 或后续新增批量接口。

## 4. 建议的请求封装（可直接使用）

新建 `frontend/js/api.js`：

```js
(function () {
  'use strict';
  window.ERP = window.ERP || {};

  function apiBase() {
    return (ERP.config && ERP.config.apiBase) || '/api';
  }
  function token() {
    return localStorage.getItem('erp.token') || '';
  }

  async function request(path, options) {
    var opts = options || {};
    var headers = Object.assign(
      { 'Content-Type': 'application/json' },
      opts.headers || {}
    );
    if (token()) headers.Authorization = 'Bearer ' + token();

    var response = await fetch(apiBase() + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });

    if (response.status === 401) {
      localStorage.removeItem('erp.token');
      location.href = ERP.url('login.html');
      throw new Error('登录已过期');
    }
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      var message = data && data.detail ? data.detail : '请求失败（' + response.status + '）';
      throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
    }
    return data;
  }

  ERP.api = {
    login: function (username, password) {
      return request('/auth/login', { method: 'POST', body: { username: username, password: password } });
    },
    me: function () { return request('/auth/me'); },
    materials: function (query) { return request('/materials' + (query || '')); },
    material: function (id) { return request('/materials/' + id); },
    stockOut: function (payload) { return request('/stock-out', { method: 'POST', body: payload }); },
    stockIn: function (payload) { return request('/stock-in', { method: 'POST', body: payload }); },
    inventory: function (query) { return request('/inventory' + (query || '')); },
    logs: function (query) { return request('/inventory/logs' + (query || '')); },
    stats: function () { return request('/inventory/stats'); }
  };
})();
```

登录页替换为：

```js
var data = await ERP.api.login(account, password);
localStorage.setItem('erp.token', data.access_token);
ERP.auth.set({ account: data.user.username, role: data.user.role, name: data.user.name, loginAt: '—' });
location.href = ERP.url('dashboard.html');
```

## 5. CORS 与部署

- 生产：前端与 `/api` 同域（Nginx 反代），后端 CORS 可留空；
- 本地：浏览器直接访问 `http://127.0.0.1:8090`，后端需在 `.env` 配置
  `CORS_ORIGINS=http://127.0.0.1:8090,http://localhost:8090`。
- 部署前把 `frontend/js/config.js` 的 `dev: true` 改为 `false`，关闭自动刷新。

## 6. 上传图片

```js
var form = new FormData();
form.append('file', fileInput.files[0]);
fetch('/api/uploads', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + localStorage.getItem('erp.token') },
  body: form
});
// -> { "url": "/uploads/xxxx.png" }，写入物料 image 字段
```

## 7. 完整接口文档

后端启动后可访问：

- Swagger UI：`http://<树莓派IP>/api/docs`
- OpenAPI JSON：`http://<树莓派IP>/api/openapi.json`

权限矩阵、错误格式、分页格式见 [`docs/BACKEND.md`](BACKEND.md)。
