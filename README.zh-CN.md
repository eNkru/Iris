# Iris

自托管的价格追踪与提醒应用。添加商品，让 Iris 帮你盯住价格变化，并在价格变动时收到通知。

![Iris 仪表盘](docs/screenshot.png)

## 功能特性

- **商品仪表盘** — 追踪商品当前价格、价格历史图表，以及每个商品的状态（正常 / 需关注 / 受阻）
- **降价提醒** — 每次价格检查都会评估可配置的提醒规则
- **提醒渠道** — 邮件和 Telegram 通知，以及周期性摘要
- **AI 驱动的内容提取** — 由任意兼容 OpenAI 的模型从商品页面提取价格；实例级 AI 设置可在运行时由管理员修改
- **反爬虫抓取** — 页面通过 [Camoufox](https://camoufox.com) 抓取，并在同一个容器内由 supervisord 管理，因此即使页面受到 DataDome / Cloudflare / Akamai 挑战保护也能正常工作
- **魔法链接登录** — 基于 better-auth 的邮箱魔法链接登录，内置初始化的管理员用户
- **调度器** — 进程内调度循环，并通过按商品划分的 single-flight 保护避免重复检查

## 技术栈

| 层级 | 技术 |
| --- | --- |
| Web 应用 | Next.js 15, React 19, Tailwind CSS v4, TanStack Query, Recharts |
| API | oRPC + Zod |
| 认证 | better-auth（魔法链接，SMTP） |
| 数据库 | SQLite + Drizzle ORM + better-sqlite3 |
| 运行时 | supervisord 管理的 Node/Python 单镜像 |
| 价格流水线 | Camoufox 抓取服务 + AI SDK（兼容 OpenAI） |
| 通知 | SMTP（nodemailer），Telegram Bot API |

## 仓库结构

pnpm monorepo（pnpm ≥ 11，Node ≥ 20）：

```
apps/
  web/            Next.js 应用 — UI、oRPC 客户端、进程内调度器入口
packages/
  api/            oRPC 路由、过程、中间件
  auth/           better-auth 配置、SMTP 魔法链接邮件、管理员初始化
  database/       SQLite Drizzle 模式、迁移、查询、种子脚本
  prices/         价格流水线（抓取 → AI 提取 → 提醒规则）、调度器、通知
  utils/          通用工具和环境校验
camoufox/         Camoufox HTTP 抓取服务源码（在镜像内运行）
Dockerfile        Node、Python、Camoufox 单镜像
supervisord.conf  管理 Web 应用和 Camoufox 进程
```

## 快速开始（Docker）

推荐的部署方式是一个容器加一个持久化 SQLite 卷。镜像通过 supervisord 运行 Next.js 应用、调度器和 Camoufox 抓取服务；启动时会自动执行迁移。

```bash
cp .env.example .env   # 调整密钥（BETTER_AUTH_SECRET、SMTP、AI_API_KEY 等）
docker compose up --build -d
```

然后打开 <http://localhost:3000>。所有应用数据都保存在 Docker 卷 `iris-data` 中。

## 本地开发

```bash
pnpm install
cp .env.example .env

# 创建/更新 ./data/iris.db
pnpm db:migrate
pnpm db:seed

# 在 Python 环境中单独运行 Camoufox 服务
# （或者使用 `docker compose up --build -d` 启动完整环境）
cd camoufox
python -m pip install camoufox fastapi uvicorn
camoufox fetch
uvicorn server:app --host 127.0.0.1 --port 8000

# 另一个终端，从仓库根目录运行
pnpm dev
```

如需接近生产环境的本地运行方式，使用 `docker compose up --build -d`；不再需要 Postgres、Redis 或独立的伴生服务容器。

### 脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 以开发模式启动 Web 应用 |
| `pnpm build` | 构建所有包 |
| `pnpm typecheck` | 类型检查所有包 |
| `pnpm lint` | 检查所有包 |
| `pnpm db:generate` | 生成 SQLite Drizzle 迁移 |
| `pnpm db:migrate` | 应用迁移 |
| `pnpm db:seed` | 填充数据库 |
| `pnpm db:studio` | 打开 Drizzle Studio |

## 配置

复制 `.env.example` 为 `.env` 并调整。重要变量如下：

| 变量 | 说明 |
| --- | --- |
| `APP_URL` | 应用公网地址（用于魔法链接邮件） |
| `BETTER_AUTH_SECRET` | 会话签名密钥——生产环境务必覆盖（`openssl rand -base64 32`） |
| `DATABASE_PATH` | SQLite 数据库路径（默认 `./data/iris.db`；Docker 使用 `/app/data/iris.db`） |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | 用于魔法链接登录邮件的 SMTP 服务器 |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | 任意兼容 OpenAI 的端点；实例级设置可在运行时由管理员修改 |
| `TELEGRAM_BOT_TOKEN` | 提醒渠道使用的 Telegram 机器人 |
| `SCHEDULER_TICK_MS` | 调度器查找到期商品的频率（默认 30 秒） |
| `CAMOUFOX_SIDECAR_URL` | 本地开发时的抓取服务地址；Docker 内部设置为 `http://127.0.0.1:8000` |

现有 Postgres 数据不会自动迁移。切换部署前，请重新添加商品，或有计划地执行手动导出/导入。

## 特别感谢

特别感谢 [LINUX DO](https://linux.do)。

## 许可证

[GPL-3.0](LICENSE)
