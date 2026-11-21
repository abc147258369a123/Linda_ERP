# Linda_ERP · 硬件社团物料台账

校内硬件社团的轻量化物料 ERP。**当前阶段：纯前端静态页面**（原生 HTML + CSS + JavaScript，无打包框架），数据暂存浏览器 `localStorage`；后端阶段将只接入数据库，不开发独立后端服务。

> 项目名称：**Linda_ERP**  
> 运行环境：桌面浏览器优先，后续部署到树莓派 4B（局域网访问）

## 目录结构

```
Linda_ERP/
├── frontend/                 前端全部代码（静态，可直接部署）
│   ├── login.html            登录页（超级管理员 / 管理员 / 普通成员）
│   ├── dashboard.html        工作台（KPI / 趋势图 / 分类占比 / 领用排行 / 预警 / 最近进出库）
│   ├── index.html            物料总览（搜索筛选 / 整行点击 / 使用车 / 导出）
│   ├── pages/
│   │   ├── material-new.html       新增 / 编辑物料
│   │   ├── material-detail.html    物料详情
│   │   ├── borrow.html             领用登记（单条 + 批量使用车）
│   │   ├── alerts.html             库存预警与补货
│   │   ├── categories.html         分类管理（支持展开物料清单）
│   │   ├── logs.html               领用日志（筛选 / 导出）
│   │   └── users.html              用户管理（三级权限）
│   ├── css/                  base / pages / dashboard / login 四套样式
│   ├── js/                   页面逻辑与数据层（store.js 为 localStorage 数据层）
│   └── assets/img/           Logo、物料示意图
├── db/                       数据库相关文件（当前为规划说明，后端阶段接入）
├── scripts/
│   ├── dev-server.js         本地静态预览服务器（仅开发用，非后端服务）
│   └── git-push.ps1          一键 add / commit / push（可选打 tag）
├── README.md
└── .gitignore
```

## 角色与权限

角色从高到低：**超级管理员 > 管理员 > 普通成员**

| 功能 | 超级管理员 | 管理员 | 普通成员 |
| --- | --- | --- | --- |
| 工作台 / 物料总览 / 详情 / 领用日志 | ✅ | ✅ | ✅ |
| 领用登记（单条 / 批量使用车） | ✅ | ✅ | ✅ |
| 新增 / 编辑物料、库存预警、分类管理、导出 | ✅ | ✅ | ❌ |
| 用户管理 | 管理全部账号、分配任意角色 | 仅管理普通成员（不能分配管理员及以上） | ❌ |
| 顶栏铃铛 | 成员访问通知面板 | 跳转库存预警页 | 不显示 |
| 成员访问记录 | 查看 | — | — |

演示账号（前端模拟，密码暂不校验）：

| 角色 | 账号 | 密码 |
| --- | --- | --- |
| 超级管理员 | `superadmin` | `super123` |
| 管理员 | `admin` | `admin123` |
| 普通成员 | `member` | `member123` |

## 本地预览

```bash
node scripts/dev-server.js 8090
```

浏览器打开 <http://127.0.0.1:8090/>（默认进入登录页）。页面监听文件变化自动刷新，便于 DSH / 浏览器边改边看。

也可以直接双击 `frontend/login.html` 预览（相对路径兼容 `file://`，但无自动刷新）。

## 数据说明（前端阶段）

- 物料 / 分类 / 用户 / 日志：`localStorage` 键 `erp.v1.data`（schema 2，结构变更会自动重置为演示数据）
- 物料使用车：`localStorage` 键 `erp.v1.cart`
- 使用车面板位置与尺寸：`erp.v1.cartPanel`
- 登录会话：`erp.v1.session`
- 成员访问记录：`erp.v1.visits`
- 所有领用 / 补货 / 标记为空都会自动写入领用日志，日志只追加不修改、永久保留

> 对接数据库阶段：用后端接口替换 [frontend/js/store.js](frontend/js/store.js) 的 localStorage 读写即可，页面逻辑无需改动。数据库表规划见 [db/README.md](db/README.md)。

## Git 版本管理

仓库默认分支 `main`。功能开发完成后手动提交并推送：

```powershell
# 在项目根目录执行
.\scripts\git-push.ps1 -Message "feat: 本次改动说明"

# 重大迭代同时打版本标签（例如 v1.0.0）
.\scripts\git-push.ps1 -Message "release: v1.0.0 首个可用版本" -Tag v1.0.0
```

首次关联远程仓库（在 GitHub 创建私有仓库 `Linda_ERP` 后）：

```powershell
.\scripts\git-push.ps1 -Message "chore: 初始化仓库" -RemoteUrl "https://github.com/<你的账号>/Linda_ERP.git"
```

也可以在脚本外手动执行：

```bash
git remote add origin <仓库地址>
git push -u origin main
git tag v1.0.0 && git push origin v1.0.0
```

规范：不自动实时提交；每次功能完成后手动执行一次提交，备注写清改动内容。

## 树莓派部署（后续阶段）

1. 将 `frontend/` 目录拷贝到树莓派，如 `/var/www/linda_erp`
2. 用 Nginx 或 `python3 -m http.server` 托管静态文件
3. 部署前将 `frontend/js/config.js` 中 `dev: true` 改为 `false`，关闭开发期自动刷新

## 当前进度

- [x] 登录页（三级角色切换）
- [x] 工作台（周期筛选 / KPI / 趋势图 / 分类占比 / 领用排行 / 库存预警 / 最近进出库）
- [x] 物料总览（搜索、多条件筛选、整行点击、Excel 导出、使用车数量弹窗）
- [x] 新增 / 编辑物料（模式联动、自动入库时间、图片选择、编辑复用）
- [x] 物料详情（完整信息、库存预警、历史领用、左卡信息充实）
- [x] 领用登记（单条 + 批量使用车、标记为空、自动日志）
- [x] 库存预警（精确计数低库存、快捷补货）
- [x] 分类管理（增删改、展开物料清单）
- [x] 领用日志（筛选、分页、管理员导出）
- [x] 用户管理（三级角色、账号保护）
- [x] 批量领用 · 物料使用车（拖动、缩放、数量编辑、内部滚动）
- [x] 活力色块 UI 主题（低饱和色块、隔行底色、无复杂阴影）
- [ ] 数据库接入（仅数据库，不做独立后端服务）
- [ ] 树莓派部署
