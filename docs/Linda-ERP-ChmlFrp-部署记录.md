# Linda ERP + ChmlFrp 公网访问部署与运维记录

> 服务器：树莓派 Ubuntu 24.04 arm64（10.72.199.41，用户 `lin`）
> 公网域名：`linda.linzetao.online`
> 部署日期：2026-11-21

## 本次访问失败的补充说明（2026-11-22）

树莓派 DHCP 地址从 `10.34.126.41` 变为 `10.72.199.41` 后，Caddy 仍绑定旧地址，日志报：

```text
listening on 10.34.126.41:3000: bind: cannot assign requested address
```

导致 Caddy 不断重启、3000 没有监听；frpc 虽然在线，但 TLS 透传到本地失败，浏览器表现为连接被重置/打不开。

已处理：

- 删除 Caddy 对旧 LAN IP 的绑定；
- 改为只绑定 `127.0.0.1:3000`；
- 重启 `firefly-blog.service`；
- 公网恢复 200。

建议在路由器里给树莓派做 **DHCP 固定租约**，或在系统里配置静态 IP，避免 IP 变化再次影响服务。

## 一、最终架构

```text
浏览器
  │ https://linda.linzetao.online
  ▼
Cloudflare DNS：CNAME → vip.xg.frp.one
  │ 解析到 ChmlFrp 节点 43.161.223.16
  ▼
ChmlFrp HTTPS 隧道（TLS 透传）
  │ 隧道 N4qPLqq4 → 127.0.0.1:3000
  ▼
树莓派 frpc / chmlfrp.service
  │
  ▼
Caddy（本地 HTTPS，Let's Encrypt 证书）
  │ reverse_proxy
  ▼
Linda ERP Nginx：127.0.0.1:8088
  │
  ▼
Linda ERP 后端 / MariaDB
```

说明：

- ChmlFrp 的 HTTPS 隧道是 **TLS 透传**，不是边缘终止，所以本地 3000 必须是 HTTPS。
- 域名仍使用 ChmlFrp 自定义域名方式：`linda.linzetao.online` CNAME 到 `vip.xg.frp.one`。
- Firefly 博客已从公网域名中移除；静态文件仍保留在服务器，但当前不再对外提供。
- 原来的 `linzetao.online` 是博客域名，已从 ChmlFrp 删除，不再作为 ERP 使用。

## 二、frpc / ChmlFrp 配置

- 服务：`chmlfrp.service`
- 配置文件：`/home/lin/pi/apps/frp_0.61.0_linux_arm64/frpc.toml`
- 当前隧道：
  - name：`N4qPLqq4`
  - localIP：`127.0.0.1`
  - localPort：`3000`
  - customDomains：`["linda.linzetao.online"]`
- 已完成：
  - 清除了手动启动的重复 frpc 进程（之前 `proxy already exists` 的根因）；
  - 配置日志持久化：`log.to = "/home/lin/pi/logs/frpc.log"`，保留 7 天；
  - `loginFailExit = false`；
  - 心跳参数 `heartbeatInterval = 10`、`heartbeatTimeout = 30`；
  - systemd drop-in：`Restart=always`、`RestartSec=3`、取消启动频率限制。

手动重启 frpc 只能使用：

```bash
sudo systemctl restart chmlfrp.service
```

不要再手动执行 `./frpc -c frpc.toml`，否则会重新出现 proxy 冲突。

## 三、Caddy / HTTPS

- 可执行文件：`/home/lin/pi/firefly/caddy`
- 配置：`/home/lin/pi/firefly/Caddyfile`
- 服务：`firefly-blog.service`（名称沿用，实际现在承载 ERP 反向代理）
- 监听：仅 `127.0.0.1:3000`（避免树莓派 DHCP 地址变化导致 Caddy 启动失败）
- 反向代理目标：`http://127.0.0.1:8088`
- 证书：
  - 域名：`linda.linzetao.online`
  - 签发：Let's Encrypt
  - 有效期：至 **2027-02-19**
  - 自动续期，证书数据目录：`/home/lin/pi/firefly/caddy-data`
- 日志：
  - `/home/lin/pi/logs/caddy-access.log`
  - `/home/lin/pi/logs/frpc.log`
  - `/home/lin/pi/logs/healthcheck.log`

### 为什么不需要改 ERP 的 8088

ERP 的 Nginx 仍监听 8088（HTTP），Caddy 负责在 3000 做 HTTPS 终止，再把请求完整反代到 8088，因此 ERP 代码、数据库、现有 8088 访问方式均不变。

## 四、验证结果

```bash
# 本地（经 Caddy → ERP 8088）
curl --resolve linda.linzetao.online:3000:127.0.0.1 \
  https://linda.linzetao.online:3000/api/health
# {"status":"ok","service":"linda-erp-backend",...}

# 树莓派本地
curl --resolve linda.linzetao.online:3000:127.0.0.1 \
  https://linda.linzetao.online:3000/api/health
# 200

# 内网直连 ERP（不经过 Caddy）
curl http://10.72.199.41:8088/api/health
# 200

# 公网
curl https://linda.linzetao.online/
# 200（ERP 登录页）

curl https://linda.linzetao.online/api/health
# {"status":"ok","service":"linda-erp-backend","environment":"production","database":"ok"}
```

证书校验：

```text
subject=CN = linda.linzetao.online
issuer = Let's Encrypt
ssl_verify_result=0
```

## 五、开机自启与故障兜底

已启用：

```text
chmlfrp.service          enabled
firefly-blog.service     enabled
firefly-health.timer     enabled
```

- `firefly-blog.service`：Caddy 异常退出自动重启；
- `chmlfrp.service`：frpc 异常退出自动重启；
- `firefly-health.timer` 每 2 分钟：
  1. 清理手动重复 frpc（如果有）；
  2. 本地 `/api/health` 非 200 → 重启 Caddy 服务；
  3. 公网 `/api/health` 非 200 → 重启 frpc 服务；
  4. 日志写入 `/home/lin/pi/logs/healthcheck.log`。

## 六、常用维护命令

```bash
# 服务状态
systemctl status firefly-blog.service --no-pager
systemctl status chmlfrp.service --no-pager
systemctl list-timers firefly-health.timer --no-pager

# 公网健康
curl -sS -o /dev/null -w '%{http_code}\n' https://linda.linzetao.online/api/health

# 日志
tail -n 50 /home/lin/pi/logs/frpc.log
tail -n 50 /home/lin/pi/logs/caddy-access.log
tail -n 50 /home/lin/pi/logs/healthcheck.log

# 重启
sudo systemctl restart firefly-blog.service
sudo systemctl restart chmlfrp.service
```

### 证书检查

```bash
echo | openssl s_client -connect linda.linzetao.online:443 \
  -servername linda.linzetao.online 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates
```

不要删除 `/home/lin/pi/firefly/caddy-data`，否则 Caddy 需要重新申请证书。

### 故障优先级

1. 本机 3000 不通：
   - 看 `systemctl status firefly-blog`
   - 看 `journalctl -u firefly-blog -n 100 --no-pager`
   - 检查 ERP 8088 是否正常
2. 本机正常、公网不通：
   - 看 `systemctl status chmlfrp`
   - 看 `/home/lin/pi/logs/frpc.log`
   - 确认 ChmlFrp 面板中隧道域名仍是 `linda.linzetao.online`，且 CNAME 仍是 `vip.xg.frp.one`
3. 出现 `proxy already exists`：
   - 杀掉 PPID 不为 1 的手动 frpc；
   - 重启 `chmlfrp.service`。
4. 浏览器证书异常：
   - 先确认公网 `curl` 正常；
   - 检查 Caddy 日志与证书续期状态。

## 七、如果以后还想恢复 Firefly 博客

Firefly 静态文件仍在：

```text
/home/lin/pi/firefly/site
```

但当前 Caddy 只配置了 ERP 域名。如需恢复博客，建议**单独申请一个博客域名/单独隧道**，不要和 ERP 共用 `linda.linzetao.online`，否则会再次出现域名冲突。

## 八、注意事项

- `firefly-blog.service` 是历史名称，现实际为 ERP 的 HTTPS 反向代理；不要误以为是博客服务。
- 不要把 3000 改成 HTTP；ChmlFrp HTTPS 隧道要求本地 TLS。
- 不要把 ERP 的域名和博客域名共用同一个 ChmlFrp 隧道。
- 当前 ERP 公网访问入口：`https://linda.linzetao.online`
- 原 ERP 内网地址 `http://10.72.199.41:8088` 仍可直接使用，不受影响。
