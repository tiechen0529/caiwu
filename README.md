# 清账：凭证与财务三表 · Docker VPS 版

镜像目标：`ghcr.io/tiechen0529/caiwu:latest`。GitHub Actions 构建通过后发布，支持 Linux amd64 和 arm64。镜像包含程序，无需在 VPS 安装 Node.js、连接 Cloudflare 或使用 ChatGPT 登录。自托管使用自己的管理员账号和 SQLite 数据库。

> 镜像是否已发布，以本仓库 Actions 最新构建结果及 GHCR Packages 为准。源码和配置文件不能替代尚未完成的镜像发布。

## 1. 默认镜像部署

VPS 安装 Docker Engine 和 Compose 插件后：

```bash
git clone https://github.com/tiechen0529/caiwu.git
cd caiwu
docker compose pull
docker compose up -d
docker compose ps
docker compose exec app node deploy/read-password.mjs
```

默认无需复制 `.env`。管理员为 `admin`；第一次启动会生成32位随机密码，存到持久化卷，重启保持不变。最后一条命令显示登录信息；密码不会写入普通应用日志。

默认映射 `127.0.0.1:8080`，用于本机反向代理或 SSH 隧道。无域名时，在自己的电脑运行：

```bash
ssh -N -L 8080:127.0.0.1:8080 root@你的VPS地址
```

然后访问 **http://127.0.0.1:8080**，使用浏览器弹出的账号密码框登录。此方式通过 SSH 加密传输，不需开放8080公网端口。

### 如果 GHCR 镜像仍为私有

公开的 GitHub 源码仓库不自动使 GHCR 镜像公开。[GHCR 官方说明](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)。若 `docker compose pull` 返回 `denied`：

- 可以在 GitHub Packages 中将 `caiwu` 镜像的可见性设为 Public，再匿名拉取。
- 或保持镜像私有，在 VPS 登录 GHCR。使用具有 `read:packages` 的 GitHub Personal Access Token (classic)，通过交互输入密码：

```bash
docker login ghcr.io -u tiechen0529
docker compose pull
docker compose up -d
```

Token仅用于镜像拉取；它不应该填入网页登录框或提交到仓库。

## 2. 用域名提供 HTTPS

先将域名 A/AAAA 记录指向 VPS，开放 TCP 80/443，并确认其他服务未占用这两个端口：

```bash
cp .env.example .env
```

编辑 `.env`，例如 `DOMAIN=finance.example.com`，再运行：

```bash
docker compose -f compose.yaml -f compose.https.yaml pull
docker compose -f compose.yaml -f compose.https.yaml up -d
docker compose exec app node deploy/read-password.mjs
```

访问 `https://你的域名`。Caddy 自动管理 HTTPS，凭证仍存于独立的数据卷。更新或停止 HTTPS 版时，使用同一组 `-f` 文件。

已有 Nginx/Caddy 时，使用默认 Compose 即可，反向代理到 `127.0.0.1:8080`，保持 Host 头，并在 `.env` 设置 `PUBLIC_ORIGIN=https://你的域名` 后重建容器。不要把带有 Basic 登录密码的 HTTP 服务直接暴露到公网。

## 3. 配置与数据

默认配置文件为 [compose.yaml](compose.yaml)，可通过 `.env` 修改：

| 配置 | 默认 | 说明 |
|---|---|---|
| QINGZHANG_IMAGE | ghcr.io/tiechen0529/caiwu:latest | 可以使用指定sha标签或digest锁定版本 |
| BIND_ADDRESS | 127.0.0.1 | 默认仅VPS本机访问 |
| APP_PORT | 8080 | 宿主机端口 |
| ADMIN_USER | admin | 管理员用户名 |
| ADMIN_PASSWORD | 空 | 自动生成；自定义须至少16字符 |
| PUBLIC_ORIGIN | 空 | 外部访问地址，用于请求来源校验 |
| DOMAIN | 空 | 自带HTTPS配置使用的域名 |

`qingzhang_data`命名卷保存 `/data/ledger.sqlite`、SQLite WAL文件、随机密码和数据库备份。重建/更新容器不会删除数据。**不要运行 `docker compose down -v`，该命令会删除数据卷。**

容器默认非root运行、根文件系统只读；`/data`可写，临时目录为tmpfs。健康检查实际查询数据库。当前一个管理员、一套账，多个设备用同一账号读取；同步依赖保存与刷新，冲突时不会覆盖另一台设备的数据。

若使用自己的密码，编辑 `.env` 并执行 `docker compose up -d --force-recreate`。留空重新采用已持久化的随机密码。用户名变化不影响现有账套。

## 4. 备份和迁移

最简单：网页“账套与期初”→下载JSON备份；新部署中登录后“恢复备份”。迁移在线 Sites 版数据也使用该方式，不会自动同步。

SQLite在线一致性备份：

```bash
docker compose exec app node deploy/backup.mjs
docker compose cp app:/data/backups ./backups
```

将备份保存到VPS之外。数据库备份不包括网页登录密码。需要恢复SQLite文件时，先停止app，再通过维护容器将备份替换为 `/data/ledger.sqlite` 并清理旧WAL/SHM；日常推荐使用网页JSON恢复，以自动执行数据校验。

## 5. 更新与回滚

```bash
docker compose pull
docker compose up -d
docker compose ps
docker compose logs --tail=100 app
```

更新前下载账套备份。回滚时在 `.env` 将 `QINGZHANG_IMAGE` 改为已发布的 `ghcr.io/tiechen0529/caiwu:sha-完整提交SHA`，再执行pull/up。不要删除数据卷。未来存在不兼容数据库迁移时，需要对应版本的数据备份。

## 6. 自动构建发布镜像

推送main或手动运行 `.github/workflows/docker-publish.yml`：

1. 安装锁定依赖，运行会计计算和自托管接口测试。
2. 构建前端及测试镜像，在GitHub runner检查启动、登录保护、数据卷和重启。
3. 测试通过后才构建并推送amd64/arm64镜像至GHCR，标记latest及提交SHA。

使用GitHub自动提供的 `GITHUB_TOKEN`，仅申请`contents:read`及`packages:write`，不用在仓库保存个人Token。[官方发布流程](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)。

## 7. 可选：从源码构建

```bash
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

此方式不依赖GHCR镜像是否已发布。用于开发或自行修改，普通使用者可直接拉取预构建镜像。

本机开发（Node.js >=24.12）：`npm ci`，`npm test`，`npm run build`，`npm start`，然后访问 http://localhost:3000。

## 财务功能范围

凭证新增/修改/删除、年初余额、66个预置科目及分级明细、自动资产负债表/利润表/现金流量表、打印/CSV导出和JSON备份。沿用[小企业会计准则](https://kjs.mof.gov.cn/zhengcefabu/201111/P020111118325852734144.pdf)主要报表项目的基础汇总口径。

金额使用整数分；借贷不平衡、缺少现金流项目、重复凭证号及非法损益结转会拦截。现金/银行内部划转不计入现金流，结转凭证不冲减利润表。期初仅支持年初启用；没有审批、锁期、税务申报、附件、多用户权限或官方表的全部细分列报。数学核对不替代业务审查。
