#!/usr/bin/env bash
# =====================================================================
# Linda_ERP · 树莓派 Ubuntu 24.04 LTS (ARM64) 一键部署脚本
# 用法（在项目根目录执行）：
#   chmod +x scripts/deploy-pi.sh
#   sudo bash scripts/deploy-pi.sh
#
# 依赖：Docker Engine + Docker Compose v2、Nginx、curl、openssl
# 国内网络：默认使用镜像前缀 docker.m.daocloud.io 与清华 pip 源，可在 .env 中修改
# =====================================================================
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

log()  { echo -e "\033[1;32m[Linda_ERP]\033[0m $*"; }
warn() { echo -e "\033[1;33m[Linda_ERP]\033[0m $*"; }
fail() { echo -e "\033[1;31m[Linda_ERP]\033[0m $*" >&2; exit 1; }

# ---------------------------------------------------------------- 0. 环境检查
[ "$(uname -m)" = "aarch64" ] || fail "当前架构为 $(uname -m)，本项目要求 ARM64/aarch64（树莓派 4B + Ubuntu 24.04）"
command -v docker >/dev/null 2>&1 || fail "未安装 Docker，请先安装 Docker Engine（arm64）"
docker compose version >/dev/null 2>&1 || fail "未安装 Docker Compose v2，请先安装 docker-compose-plugin"

MEM_KB=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
MEM_GB=$((MEM_KB / 1024 / 1024))
log "检测到内存 ${MEM_GB}GB（建议 8GB；compose 限制：后端 4GB / 数据库 2GB）"
[ "$MEM_GB" -ge 6 ] || warn "内存小于 6GB，4GB+2GB 的限制可能不足，请谨慎运行"

DISK_AVAIL=$(df -Pk "$PROJECT_DIR" | awk 'NR==2 {print int($4/1024/1024)}')
log "项目所在磁盘可用约 ${DISK_AVAIL}GB（要求约 25GB）"
[ "$DISK_AVAIL" -ge 5 ] || warn "磁盘可用空间不足 5GB，数据库与日志可能无法正常写入"

# ---------------------------------------------------------------- 1. 目录与权限
log "创建持久化目录 ./data/{mariadb,uploads,logs,backups}"
sudo mkdir -p data/mariadb data/uploads data/logs data/backups
# MariaDB 官方镜像内 mysql 用户为 999；后端镜像内 app 用户为 1000
sudo chown -R 999:999 data/mariadb
sudo chown -R 1000:1000 data/uploads data/logs

# ---------------------------------------------------------------- 2. 生成 .env
if [ ! -f .env ]; then
  log "未发现 .env，基于 .env.example 生成随机密钥"
  cp .env.example .env
  DB_ROOT_PASSWORD="$(openssl rand -hex 16)"
  DB_PASSWORD="$(openssl rand -hex 16)"
  JWT_SECRET="$(openssl rand -hex 32)"
  ADMIN_PASSWORD="$(openssl rand -hex 8)"
  LAN_IP="$(hostname -I | awk '{print $1}')"
  sed -i "s|^DB_ROOT_PASSWORD=.*|DB_ROOT_PASSWORD=${DB_ROOT_PASSWORD}|" .env
  sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=${DB_PASSWORD}|" .env
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" .env
  sed -i "s|^INIT_ADMIN_PASSWORD=.*|INIT_ADMIN_PASSWORD=${ADMIN_PASSWORD}|" .env
  sed -i "s|^CORS_ORIGINS=.*|CORS_ORIGINS=http://${LAN_IP},http://127.0.0.1:8090,http://localhost:8090|" .env
  chmod 600 .env
  log "已生成 .env（请妥善保管，勿提交 Git）"
else
  log ".env 已存在，跳过生成（如需重置请先备份并删除 .env）"
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

# 安全检查：禁止使用示例占位密码
for secret_var in DB_ROOT_PASSWORD DB_PASSWORD JWT_SECRET INIT_ADMIN_PASSWORD; do
  if [ "${!secret_var:-}" = "" ] || [[ "${!secret_var}" == change_me* ]]; then
    fail ".env 中的 ${secret_var} 仍为示例值/空值，请修改为强随机值后再部署"
  fi
done

# ---------------------------------------------------------------- 3. 构建并启动
log "拉取 MariaDB 10.11 镜像（前缀：${IMAGE_PREFIX:-无}）"
if ! docker compose pull mariadb; then
  fail "MariaDB 镜像拉取失败。请检查 .env 的 IMAGE_PREFIX（国内镜像前缀），或按 docs/BACKEND.md「国内网络 / 离线镜像」导入离线镜像"
fi

log "构建后端镜像（Python 3.12 + 清华 pip 源）"
if ! docker compose build backend; then
  fail "后端镜像构建失败。请检查 .env 的 PIP_INDEX_URL / IMAGE_PREFIX 与网络，或使用离线镜像方案"
fi

log "启动服务（后端 4GB / 数据库 2GB 内存限制）"
docker compose up -d

# ---------------------------------------------------------------- 4. 等待健康检查
log "等待后端健康检查通过 …"
HEALTH_OK=0
for _ in $(seq 1 60); do
  if curl -fsS --max-time 3 http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
    HEALTH_OK=1
    break
  fi
  sleep 3
done
if [ "$HEALTH_OK" -ne 1 ]; then
  warn "后端健康检查未通过，请查看：docker compose logs --tail=80 backend"
  fail "部署中止"
fi
log "后端健康检查通过：$(curl -fsS http://127.0.0.1:8000/api/health)"

# ---------------------------------------------------------------- 5. 初始化管理员
log "初始化管理员账号：${INIT_ADMIN_USERNAME}（角色 ${INIT_ADMIN_ROLE}）"
printf '%s\n' "${INIT_ADMIN_PASSWORD}" | docker compose exec -T backend \
  python -m app.cli create-admin \
  --username "${INIT_ADMIN_USERNAME}" \
  --name "${INIT_ADMIN_NAME}" \
  --role "${INIT_ADMIN_ROLE}" \
  --note "初始超级管理员" \
  --password-stdin || warn "管理员 ${INIT_ADMIN_USERNAME} 已存在，跳过创建"

# ---------------------------------------------------------------- 6. Nginx
if command -v nginx >/dev/null 2>&1; then
  log "配置 Nginx 反向代理（项目路径：${PROJECT_DIR}）"
  TMP_CONF="$(mktemp)"
  sed -e "s|__PROJECT_DIR__|${PROJECT_DIR}|g" \
      -e "s|__SERVER_NAME__|_|g" \
      nginx/linda_erp.conf > "$TMP_CONF"
  sudo cp "$TMP_CONF" /etc/nginx/sites-available/linda_erp.conf
  sudo ln -sf /etc/nginx/sites-available/linda_erp.conf /etc/nginx/sites-enabled/linda_erp.conf
  sudo rm -f /etc/nginx/sites-enabled/default
  sudo nginx -t
  sudo systemctl reload nginx
  log "Nginx 已重载"
else
  warn "未安装 Nginx，已跳过反向代理配置。"
  warn "安装后执行：sudo cp nginx/linda_erp.conf /etc/nginx/sites-available/linda_erp.conf && sudo ln -s ..."
fi

# ---------------------------------------------------------------- 7. 生产模式提示
if grep -q "dev: true" frontend/js/config.js 2>/dev/null; then
  warn "前端 config.js 仍为 dev: true（开发期自动刷新），生产部署建议改为 false"
  warn "执行：sed -i 's/dev: true/dev: false/' frontend/js/config.js"
fi

# ---------------------------------------------------------------- 8. 结果
LAN_IP="$(hostname -I | awk '{print $1}')"
cat <<EOF

============================================================
 Linda_ERP 部署完成 ✅
------------------------------------------------------------
 前端：      http://${LAN_IP}/
 后端健康：  curl http://127.0.0.1:8000/api/health
 API 文档：  http://${LAN_IP}/api/docs
 管理员：    ${INIT_ADMIN_USERNAME} / ${INIT_ADMIN_PASSWORD}
             （已写入 .env 的 INIT_ADMIN_PASSWORD，请尽快修改）
 数据目录：  ${PROJECT_DIR}/data
 查看日志：  docker compose logs -f backend
 重启：      docker compose restart
 停止：      docker compose down
============================================================
EOF
