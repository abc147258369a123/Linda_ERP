# Linda_ERP · 硬件社团物料台账

校内硬件社团的轻量化物料 ERP，包含**原生静态前端**与 **FastAPI + MariaDB 后端**。  
后端面向 Raspberry Pi 4B 8GB + Ubuntu 24.04 LTS（ARM64）部署，使用 Docker + Docker Compose v2。

> 项目名称：**Linda_ERP**  
> 前端：原生 HTML + CSS + JavaScript（无需构建）  
> 后端：Python 3.12 + FastAPI + Uvicorn（ASGI）+ MariaDB 10.11

## 目录结构

```
Linda_ERP/
├── frontend/                 前端全部代码（静态，可直接由 Nginx 托管）
│   ├── login.html            登录页（超级管理员 / 管理员 / 普通成员）
│   ├── dashboard.html        工作台
│   ├── index.html            物料总览
│   ├── pages/                物料新增 / 详情 / 领用 / 预警 / 分类 / 日志 / 用户
│   ├── css/ · js/            样式与页面逻辑（store.js 当前为 localStorage 演示数据层）
│   └── assets/img/           Logo、物料示意图
├── backend/                  后端服务（FastAPI，Docker 部署）
│   ├── app/
│   │   ├── main.py           应用入口 / 健康检查 / 路由注册 / CORS
│   │   ├── config.py         环境变量配置
│   │   ├── db.py             SQLAlchemy + PyMySQL 数据层
│   │   ├── models.py         ORM 模型
│   │   ├── security.py       bcrypt 密码哈希 + JWT
│   │   ├── deps.py           登录 / 角色权限依赖
│   │   ├── schemas.py        请求校验模型
│   │   ├── cli.py            管理员初始化命令
│   │   └── routers/          auth / users / categories / materials / stock / inventory / uploads
│   ├── Dockerfile            生产镜像（非 root、arm64）
│   └── requirements.txt      依赖版本全部锁定
├── db/
│   ├── init/                 建表 SQL + 初始基础数据（MariaDB 首次启动自动执行）
│   └── README.md             表结构与前端数据对应说明
├── docs/
│   ├── BACKEND.md            后端交付说明（12 项要求）
│   └── FRONTEND-INTEGRATION.md  前端对接后端修改指南
├── nginx/linda_erp.conf      Nginx 反向代理配置
├── scripts/
│   ├── deploy-pi.sh          树莓派一键部署脚本
│   ├── dev-server.js         本地静态预览服务器（仅开发用）
│   └── git-push.ps1          一键 add / commit / push（可选打 tag）
├── docker-compose.yml        后端 + MariaDB（端口只绑定 127.0.0.1）
├── .env.example              环境变量模板（含机密项标注）
└── README.md
```

## 快速开始

### 前端（本地演示）

```bash
node scripts/dev-server.js 8090
```

浏览器打开 <http://127.0.0.1:8090/>。演示账号：

| 角色 | 账号 | 密码 |
| --- | --- | --- |
| 超级管理员 | `superadmin` | `super123` |
| 管理员 | `admin` | `admin123` |
| 普通成员 | `member` | `member123` |

> 前端当前仍使用 `localStorage` 演示数据；切换后端的步骤见 [docs/FRONTEND-INTEGRATION.md](docs/FRONTEND-INTEGRATION.md)。

### 后端（树莓派 Docker 部署）

```bash
# 1. 将项目上传到树莓派，如 /opt/linda_erp
# 2. 一键部署（自动生成密钥、建表、启动、健康检查、初始化管理员、配置 Nginx）
sudo bash scripts/deploy-pi.sh

# 3. 验证
curl -fsS http://127.0.0.1:8000/api/health
```

- 后端交付细节（技术栈 / 依赖锁定 / 建表 SQL / 环境变量 / 生产启动 / 持久化 / 端口 / 健康检查 / Nginx / 管理员初始化）：见 **[docs/BACKEND.md](docs/BACKEND.md)**
- 接口文档（运行后）：`http://<树莓派IP>/api/docs`

## 角色与权限

角色从高到低：**超级管理员 > 管理员 > 普通成员**（后端与前端一致）

| 功能 | 超级管理员 | 管理员 | 普通成员 |
| --- | --- | --- | --- |
| 工作台 / 物料总览 / 详情 / 领用日志 | ✅ | ✅ | ✅ |
| 领用登记（单条 / 批量使用车） | ✅ | ✅ | ✅ |
| 新增 / 编辑物料、库存预警、分类管理、导出 | ✅ | ✅ | ❌ |
| 用户管理 | 管理全部账号、分配任意角色 | 仅管理普通成员 | ❌ |
| 顶栏铃铛 / 访问记录 | 成员访问通知面板 | 跳转库存预警页 | 不显示 |

## 部署约束落实（树莓派 4B 8GB）

| 约束 | 落实 |
| --- | --- |
| 内存：数据库 2GB / 后端 4GB / 系统预留 2GB | compose `mem_limit: 2g` / `4g`，MariaDB 缓冲池 1GB |
| 磁盘约 25GB | 数据与日志挂载 `./data`，日志滚动限量 |
| 国内网络、无法直连 Docker Hub/GitHub 大文件 | `IMAGE_PREFIX` 国内镜像前缀 + 清华 pip 源，依赖均为小体积 PyPI 包 |
| 禁止 SQL Server/Oracle/Elasticsearch/GPU/x86 包 | 仅 MariaDB 10.11 + Python 依赖，全部 ARM64 可用 |
| 数据库仅 MariaDB/PostgreSQL，优先 MariaDB 10.11 | 使用 MariaDB 10.11 |

## Git 版本管理

功能开发完成后手动提交并推送：

```powershell
.\scripts\git-push.ps1 -Message "feat: 本次改动说明"

# 重大迭代同时打版本标签
.\scripts\git-push.ps1 -Message "release: v1.1.0" -Tag v1.1.0
```

首次关联远程仓库（GitHub 私有仓库 `Linda_ERP`）：

```powershell
.\scripts\git-push.ps1 -Message "chore: 初始化仓库" -RemoteUrl "https://github.com/<你的账号>/Linda_ERP.git"
```

规范：不自动实时提交；每次功能完成后手动执行一次提交。

## 当前进度

**前端（已完成）**

- [x] 登录页、工作台、物料总览 / 新增 / 编辑 / 详情
- [x] 领用登记（单条 + 批量使用车）、库存预警、分类管理、领用日志、用户管理
- [x] 三级角色权限、访问记录、活力色块 UI 主题

**后端（已完成，待树莓派实机部署验证）**

- [x] 用户登录（JWT + bcrypt）、角色权限
- [x] 物料档案管理、物料分类
- [x] 入库单、出库单（领用 / 标记为空）
- [x] 库存查询、低库存预警、流水日志
- [x] 用户管理、成员访问记录、图片上传
- [x] Dockerfile / docker-compose / Nginx 配置 / 一键部署脚本
- [ ] 树莓派实机部署与前端接口联调
