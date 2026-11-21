# Linda_ERP 后端说明（Raspberry Pi 4B / ARM64 / Docker Compose v2）

> 目标环境：Raspberry Pi 4B 8GB + Ubuntu 24.04 LTS（aarch64）+ Docker Engine + Docker Compose v2
> 业务：用户登录（管理员权限区分）、物料档案管理、入库单、出库单、库存查询
> 接口风格：RESTful + JSON，前端通过 Nginx 反向代理访问

## 1. 技术栈说明（版本已锁定）

| 项目 | 选型与版本 | 说明 |
| --- | --- | --- |
| 编程语言 | Python **3.12**（基础镜像 `python:3.12-slim-bookworm`） | ARM64 官方镜像，依赖全部有 aarch64 轮子 |
| Web 框架 | **FastAPI 0.115.6** | RESTful + 自动 OpenAPI 文档 |
| ASGI 服务 | **Uvicorn 0.34.0** | 生产模式 `--workers 2`，关闭 reload/debug |
| ORM | **SQLAlchemy 2.0.36** | 同步引擎 + FastAPI 线程池 |
| 数据库驱动 | **PyMySQL 1.1.1** | 纯 Python，无 ARM64 编译问题 |
| 数据库 | **MariaDB 10.11**（Docker 镜像） | 满足 arm64，优先 MariaDB 的约束 |
| 密码哈希 | **bcrypt 4.2.1**（cost=12） | 禁止明文，登录校验使用 bcrypt |
| 鉴权 | **PyJWT 2.10.1** | JWT Bearer Token，HS256 |
| 文件上传 | python-multipart 0.0.20 | 物料图片上传（≤10MB） |

## 2. 依赖锁定文件

见 [`backend/requirements.txt`](../backend/requirements.txt)，全部为固定版本（无 `~=` / `^`）：

```
fastapi==0.115.6
uvicorn==0.34.0
SQLAlchemy==2.0.36
PyMySQL==1.1.1
pydantic==2.10.4
bcrypt==4.2.1
PyJWT==2.10.1
cryptography==44.0.0
python-multipart==0.0.20
```

## 3. 建表 SQL 与初始数据

- 建表 SQL：[`db/init/01_schema.sql`](../db/init/01_schema.sql)
  - `users`（含 bcrypt 密码哈希、角色 super/admin/member）
  - `categories`、`materials`
  - `stock_in_orders` / `stock_in_items`（入库单）
  - `stock_out_orders` / `stock_out_items`（出库单）
  - `material_logs`（领用 / 入库 / 标记为空流水，只追加）
  - `user_visits`（成员访问记录，供超管通知面板）
- 初始基础数据：[`db/init/02_seed.sql`](../db/init/02_seed.sql)
  - 9 个物料分类（基础元件、主控模块…）
  - 管理员账号不写死在 SQL 中，使用 `app.cli create-admin` 以 bcrypt 哈希创建（见第 12 项）
- 自动执行：SQL 挂载到 MariaDB 容器的 `/docker-entrypoint-initdb.d`，**仅首次初始化数据目录时执行**（`./data/mariadb` 为空时）。

## 4. 环境变量清单

完整模板：[`.env.example`](../.env.example)（复制为 `.env` 后使用）。

| 变量 | 示例值 | 机密 | 说明 |
| --- | --- | --- | --- |
| `APP_ENV` | `production` | | 生产模式，禁止 debug |
| `APP_HOST` / `APP_PORT` | `127.0.0.1` / `8000` | | 后端只监听回环地址 |
| `WORKERS` | `2` | | Uvicorn worker 数 |
| `DB_NAME` | `linda_erp` | | 数据库名（与初始化 SQL 一致，不建议改） |
| `DB_USER` | `linda_erp` | | 业务数据库账号 |
| `DB_PASSWORD` | `随机32位` | ✅ | 业务数据库密码 |
| `DB_ROOT_PASSWORD` | `随机32位` | ✅ | 数据库 root 密码 |
| `DB_HOST` / `DB_PORT` | `127.0.0.1` / `3306` | | DB 只发布到本机回环 |
| `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` | `10` / `20` | | 连接池 |
| `JWT_SECRET` | `随机64位` | ✅ | JWT 签名密钥，生产必须修改 |
| `JWT_ALGORITHM` | `HS256` | | |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `720` | | Token 有效期 |
| `CORS_ORIGINS` | `http://192.168.1.20,http://127.0.0.1:8090` | | 逗号分隔；同域反代时可留空 |
| `LOG_LEVEL` / `LOG_DIR` | `INFO` / `/app/logs` | | 日志级别与容器内目录 |
| `UPLOAD_DIR` / `MAX_UPLOAD_MB` | `/app/uploads` / `10` | | 附件目录与上传上限 |
| `INIT_ADMIN_USERNAME` / `INIT_ADMIN_NAME` | `superadmin` / `周明` | | 部署脚本初始化账号 |
| `INIT_ADMIN_PASSWORD` | `随机16位` | ✅ | 初始超管密码，首次登录后修改 |
| `IMAGE_PREFIX` | `docker.m.daocloud.io/library/` | | 国内 Docker Hub 镜像前缀 |
| `PIP_INDEX_URL` | `https://pypi.tuna.tsinghua.edu.cn/simple` | | 国内 pip 源 |
| `DB_PUBLISH_PORT` | `3306` | | 数据库映射到宿主机的回环端口 |
| `DB_INNODB_BUFFER_POOL` | `1G` | | InnoDB 缓冲池（数据库 2GB 限制内） |

## 5. 生产模式启动命令（禁止 reload / debug）

容器内实际命令（Dockerfile 已固化）：

```bash
uvicorn app.main:app \
  --host 127.0.0.1 \
  --port 8000 \
  --workers 2 \
  --proxy-headers \
  --forwarded-allow-ips=127.0.0.1
```

- 不启用 `--reload`，`FastAPI(debug=False)`
- 由 Docker Compose 托管，失败自动重启（`restart: unless-stopped`）
- 手动启动：`docker compose up -d --build`

## 6. Dockerfile 与部署命令

- Dockerfile：[`backend/Dockerfile`](../backend/Dockerfile)
  - ARM64 基础镜像（可经 `IMAGE_PREFIX` 走国内镜像）
  - pip 国内源 `PIP_INDEX_URL`
  - 非 root 用户（UID 1000）运行
  - 内置健康检查
- 分步部署命令（树莓派 Ubuntu 24.04）：

```bash
# 0) 安装 Docker 与依赖（使用国内镜像源安装 docker-ce / compose 插件 / Nginx）
sudo apt-get update
sudo apt-get install -y ca-certificates curl openssl nginx
# 配置 Docker Hub 镜像加速（可选，任选其一；与 .env 的 IMAGE_PREFIX 二选一即可）
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{ "registry-mirrors": ["https://docker.m.daocloud.io"] }
EOF
sudo systemctl restart docker

# 1) 准备项目
sudo mkdir -p /opt/linda_erp
# 将项目文件上传（scp/SFTP）到 /opt/linda_erp，确保包含 frontend/ backend/ db/ nginx/ scripts/
cd /opt/linda_erp
chmod +x scripts/deploy-pi.sh

# 2) 一键部署
sudo bash scripts/deploy-pi.sh
```

`deploy-pi.sh` 自动完成：目录与权限 → 生成 `.env` 随机密钥 → 拉取/构建镜像 → 启动 → 健康检查 → 初始化管理员 → 配置 Nginx → 输出访问地址。

### 国内网络 / 离线镜像

- 默认走镜像前缀 `docker.m.daocloud.io/library/`（`.env` 的 `IMAGE_PREFIX`）与清华 pip 源；
- 若镜像加速不可用，可在有网的机器上（Linux，或任意平台加 `--platform linux/arm64`）预拉取后离线导入：

```bash
# 有网机器（同架构或指定 arm64）
docker pull --platform linux/arm64 mariadb:10.11
docker pull --platform linux/arm64 python:3.12-slim-bookworm
docker save mariadb:10.11 python:3.12-slim-bookworm -o linda_erp_images.tar
# 传输到树莓派后
docker load -i linda_erp_images.tar
# 将 .env 中 IMAGE_PREFIX 置空（使用本地镜像），再执行部署脚本
sed -i 's|^IMAGE_PREFIX=.*|IMAGE_PREFIX=|' .env
```

- 后端镜像由 Dockerfile 在本机构建（不走 GitHub 大文件下载）；若 pip 源也不可达，可在内网搭建 PyPI 镜像并通过 `PIP_INDEX_URL` 指向。

## 7. 前端说明（挂载目录）

- 前端是**原生静态 HTML/CSS/JS，无需构建**，目录为项目内 `frontend/`。
- compose 内 `linda_erp_web`（nginx:alpine，host 网络）把 `./frontend` 只读挂载到容器 `/usr/share/nginx/html`，监听 **8088**，同时反代 `/api/` 与 `/uploads/`。
- 若宿主机已安装 Nginx，也可使用 `nginx/linda_erp.conf` 作为 80 端口入口（静态根目录为 `<项目路径>/frontend`）。
- 前端页面通过同源 `/api/` 调用后端；静态资源与上传图片由 Nginx 直接提供。
- 生产部署建议把 `frontend/js/config.js` 的 `dev: true` 改为 `false`（关闭开发期自动刷新）。

## 8. 持久化目录清单（docker 挂载）

| 宿主机目录 | 容器路径 | 用途 |
| --- | --- | --- |
| `./data/mariadb` | `/var/lib/mysql` | MariaDB 数据文件 |
| `./data/uploads` | `/app/uploads`（后端）、`/data/uploads`（Nginx 只读） | 物料图片等上传附件 |
| `./data/logs` | `/app/logs` | 后端运行日志（10MB × 5 滚动） |
| `./data/backups` | 宿主机保留 | 数据库备份（建议脚本 `mariadb-dump` 输出） |
| `./frontend` | `/usr/share/nginx/html`（Nginx 只读） | 前端静态页面 |

> 备份建议：`docker compose exec -T mariadb mariadb-dump -uroot -p"$DB_ROOT_PASSWORD" --single-transaction linda_erp > data/backups/linda_erp_$(date +%F).sql`

## 9. 端口监听

| 服务 | 监听地址 | 说明 |
| --- | --- | --- |
| 后端 Uvicorn | **127.0.0.1:8000** | 容器使用 host 网络，严格只监听回环；外部经 Nginx 访问 |
| MariaDB | **127.0.0.1:3306** | compose 端口映射 `127.0.0.1:3306:3306`，不对外 |
| 前端 Nginx | `0.0.0.0:8088` | compose 内 `linda_erp_web`；避开宿主机已有 NPM 的 80/81/443 |
| 宿主机 Nginx（可选） | `0.0.0.0:80` | 仅在宿主机安装 Nginx 且 80 空闲时使用 |

> 本机实机环境已有 Nginx Proxy Manager 占用 80/81/443，因此采用容器 Nginx 监听 8088，不影响原有服务；如需域名/HTTPS，可在 NPM 中把域名反代到 `http://10.34.126.41:8088`。

## 10. 健康检查命令

```bash
curl -fsS http://127.0.0.1:8000/api/health
# 期望：{"status":"ok","service":"linda-erp-backend","version":"1.0.0","environment":"production","database":"ok"}

# 经前端 Nginx 容器（8088）：
curl -fsS http://127.0.0.1:8088/api/health
```

## 11. Nginx 反向代理要点

配置文件：

- 容器 Nginx：[`nginx/linda_erp.container.conf`](../nginx/linda_erp.container.conf)（compose 默认使用，监听 8088）
- 宿主机 Nginx：[`nginx/linda_erp.conf`](../nginx/linda_erp.conf)（可选）

- **无需 WebSocket**：本项目为纯 HTTP/JSON 接口，未使用 WebSocket。
- **文件上传上限**：`client_max_body_size 10m`（与后端 `MAX_UPLOAD_MB=10` 一致）。
- **超时**：`proxy_connect_timeout 5s`、`proxy_send_timeout 60s`、`proxy_read_timeout 60s`。
- **代理目标**：`http://127.0.0.1:8000`，保留 `Host / X-Real-IP / X-Forwarded-For / X-Forwarded-Proto`。
- **静态资源**：前端根目录 + `/uploads/` 指向 `data/uploads/`，开启缓存。
- **上传大小若调整**：同时修改 Nginx `client_max_body_size` 与 `.env` 中 `MAX_UPLOAD_MB`。

## 12. 管理员账号初始化方式

密码使用 **bcrypt 哈希** 后写入数据库，命令行不落盘明文（支持 stdin 传入）：

```bash
cd /opt/linda_erp

# 创建超级管理员（首次部署脚本已自动执行；也可手动执行）
printf '%s\n' 'YourStrongPassword' | docker compose exec -T backend \
  python -m app.cli create-admin \
  --username superadmin \
  --name 周明 \
  --role super \
  --note "指导老师" \
  --password-stdin

# 重置已存在账号的密码
printf '%s\n' 'NewStrongPassword' | docker compose exec -T backend \
  python -m app.cli create-admin --username superadmin --name 周明 --role super \
  --reset-password --password-stdin

# 查看账号
docker compose exec -T backend python -m app.cli list-users
```

生产模式启动时会校验 `JWT_SECRET` / `DB_PASSWORD` 是否为示例值，未修改会拒绝启动。

---

## API 概览（基础地址 `/api`）

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | 公开 | 登录，返回 JWT 与用户信息 |
| GET | `/api/auth/me` | 登录 | 当前用户 |
| POST | `/api/auth/change-password` | 登录 | 修改自己的密码 |
| GET | `/api/users` | 管理员+ | 用户列表 |
| POST | `/api/users` | 管理员+ | 新增用户（管理员仅可建普通成员） |
| PATCH | `/api/users/{id}` | 管理员+ | 编辑 / 重置密码 / 分配角色（超管可分配任意角色） |
| DELETE | `/api/users/{id}` | 管理员+ | 删除用户（保护最后超管/管理员与当前账号） |
| GET | `/api/visits` | 超管 | 成员访问记录 |
| GET/POST/PATCH/DELETE | `/api/categories` | 登录/管理员+ | 分类查询与维护 |
| GET | `/api/materials` | 登录 | 物料搜索 / 筛选 / 分页 |
| GET | `/api/materials/{id}` | 登录 | 物料详情 |
| POST/PATCH | `/api/materials` | 管理员+ | 新增 / 编辑物料档案 |
| PATCH | `/api/materials/{id}/status` | 管理员+ | 有货 / 空切换 |
| GET | `/api/materials/{id}/logs` | 登录 | 物料历史流水 |
| POST | `/api/stock-in` | 管理员+ | 创建入库单（补货） |
| GET | `/api/stock-in`、`/{id}` | 管理员+ | 入库单列表 / 详情 |
| POST | `/api/stock-out` | 登录 | 创建出库单（领用；标记为空仅管理员） |
| GET | `/api/stock-out`、`/{id}` | 管理员+ | 出库单列表 / 详情 |
| GET | `/api/inventory` | 登录 | 库存查询（搜索 / 模式 / 状态 / 分类 / 低库存） |
| GET | `/api/inventory/warnings` | 管理员+ | 低库存预警 |
| GET | `/api/inventory/logs` | 登录 | 流水日志（关键词 / 类型 / 分类 / 日期） |
| GET | `/api/inventory/stats` | 登录 | 工作台统计 |
| POST | `/api/uploads` | 管理员+ | 上传物料图片（≤10MB） |
| GET | `/api/health` | 公开 | 健康检查（含数据库连通） |

响应为 JSON；分页统一返回 `{items,total,page,page_size}`；错误返回 `{"detail":"..."}` 与 4xx/5xx 状态码；认证头 `Authorization: Bearer <token>`。

## 与部署约束的对应

| 约束 | 落实方式 |
| --- | --- |
| 内存：DB 2GB / 后端 4GB / 系统预留 2GB | compose `mem_limit: 2g` / `4g`，MariaDB `innodb-buffer-pool-size=1G`，总计 ≤ 6GB |
| 磁盘约 25GB | 数据目录 `./data`；Docker 镜像约 1.5GB，日志滚动限量 |
| 国内网络、无法直连 Docker Hub/GitHub 大文件 | `IMAGE_PREFIX` 镜像前缀 + 清华 pip 源；依赖全部为小体积 PyPI 包；无 GitHub 大文件依赖 |
| 全部依赖 ARM64 | Python 3.12 slim、MariaDB 10.11、Python 依赖均有 aarch64 wheel，无 SQL Server/Oracle/ES/GPU/x86 包 |
| 数据库仅 MariaDB/PostgreSQL，优先 MariaDB 10.11 | 使用 MariaDB 10.11 |
