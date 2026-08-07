# Iris

自托管的价格追踪与提醒应用。添加商品，让 Iris 帮你盯住价格变化，并在价格变动时收到通知。

![Iris 仪表盘](docs/screenshot.png)

## 功能特性

- **商品仪表盘** — 追踪商品当前价格、价格历史图表，以及每个商品的状态（正常 / 需关注 / 受阻）
- **降价提醒** — 每次价格检查都会评估可配置的提醒规则
- **提醒渠道** — 邮件和 Telegram 通知，以及周期性摘要
- **AI 驱动的内容提取** — 由任意兼容 OpenAI 的模型从商品页面提取价格（OpenAI、OpenRouter、本地 Ollama 服务器等）；实例级 AI 设置可在运行时由管理员修改
- **反爬虫抓取** — 页面通过 [Camoufox](https://camoufox.com) 伴生服务（反检测版 Firefox）抓取，作为唯一的抓取通道，因此即使页面受到 DataDome / Cloudflare / Akamai 挑战保护也能正常工作
- **魔法链接登录** — 基于 better-auth 的邮箱魔法链接登录，内置初始化的管理员用户
- **调度器** — 进程内调度循环，配合 Redis 分布式锁，多个应用副本绝不会重复处理同一商品

## 技术栈

| 层级 | 技术 |
| --- | --- |
| Web 应用 | Next.js 15, React 19, Tailwind CSS v4, TanStack Query, Recharts |
| API | oRPC + Zod |
| 认证 | better-auth（魔法链接，SMTP） |
| 数据库 | PostgreSQL 16 + Drizzle ORM |
| 缓存 / 锁 | Redis 7（会话缓存，调度器锁） |
| 价格流水线 | Camoufox 抓取伴生服务 + AI SDK（兼容 OpenAI） |
| 通知 | SMTP（nodemailer），Telegram Bot API |

## 仓库结构

pnpm monorepo（pnpm ≥ 11，Node ≥ 20）：

```
apps/
  web/            Next.js 应用 — UI、oRPC 客户端、进程内调度器入口
packages/
  api/            oRPC 路由、过程、中间件
  auth/           better-auth 配置、SMTP 魔法链接邮件、会话缓存、管理员初始化
  database/       Drizzle 模式、迁移、查询、种子脚本
  prices/         价格流水线（抓取 → AI 提取 → 提醒规则）、调度器、通知
  utils/          通用工具、环境校验、redis 客户端
camoufox/         Camoufox 抓取伴生服务（Python 服务，以独立容器运行）
```

## 快速开始（Docker）

运行 Iris 最快的方式——一条命令即可拉起应用、Camoufox 伴生服务、Postgres 和 Redis。应用启动时自动执行迁移。

```bash
cp .env.example .env   # 调整密钥（BETTER_AUTH_SECRET、SMTP、AI_API_KEY 等）
docker compose up --build -d
```

然后打开 <http://localhost:3000>。

> Camoufox 伴生服务是必需依赖：应用会读取 `CAMOUFOX_SIDECAR_URL`，如果伴生服务宕机，应用会快速失败并记录错误日志，而不是静默地表现异常。

## 本地开发

```bash
pnpm install

# 启动 Postgres + Redis + Camoufox 伴生服务（可单独复用）
docker compose up postgres redis camoufox

# 复制并调整你的环境变量
cp .env.example .env

# 运行迁移（幂等）和可选的种子数据
pnpm db:migrate
pnpm db:seed

# 启动 Next.js 开发服务器（http://localhost:3000）
pnpm dev
```

### 脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 以开发模式启动 Web 应用 |
| `pnpm build` | 构建所有包 |
| `pnpm typecheck` | 类型检查所有包 |
| `pnpm lint` | 检查所有包 |
| `pnpm db:generate` | 根据 schema 生成 Drizzle 迁移 |
| `pnpm db:migrate` | 应用迁移 |
| `pnpm db:seed` | 填充数据库 |
| `pnpm db:studio` | 打开 Drizzle Studio |

## 配置

复制 `.env.example` 为 `.env` 并调整。重要变量如下：

| 变量 | 说明 |
| --- | --- |
| `APP_URL` | 应用公网地址（用于魔法链接邮件） |
| `BETTER_AUTH_SECRET` | 会话签名密钥——生产环境务必覆盖（`openssl rand -base64 32`） |
| `DATABASE_URL` | Postgres 连接字符串 |
| `REDIS_URL` | Redis 连接字符串（会话缓存 + 调度器锁） |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | 用于魔法链接登录邮件的 SMTP 服务器 |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | 任意兼容 OpenAI 的端点；构建期默认值——实例级设置可在运行时由管理员修改 |
| `TELEGRAM_BOT_TOKEN` | 提醒渠道使用的 Telegram 机器人 |
| `SCHEDULER_TICK_MS` | 调度器查找到期商品的频率（默认 30 秒） |
| `SCHEDULER_LOCK_TTL_SECONDS` | Redis 锁 TTL，防止并发副本重复处理（默认 60 秒） |
| `CAMOUFOX_SIDECAR_URL` | Camoufox 伴生服务地址（必填）。`pnpm dev` 使用 `http://localhost:8000`，Compose 内部为 `http://camoufox:8000` |

## 特别感谢

特别感谢 [LINUX DO](https://linux.do)。

## 许可证

[GPL-3.0](LICENSE)
