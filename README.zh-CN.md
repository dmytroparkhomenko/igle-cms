# Igle CMS

*[English version](README.md)*

Igle CMS 是一款专为运营大批联盟营销（affiliate）及 PBN（私有博客网络）站点而打造的静态站点内容管理系统：从模板导入或生成站点、进行可视化或代码编辑、管理 SEO、对联盟链接做跳转伪装（cloaking），并部署到真实的 VPS 面板（aaPanel 或 CloudPanel）——所有操作都在一个后台应用中完成，每一次有意义的改动都会被记录为一次 Git 提交。

本 README 描述的是代码库的真实现状，所有内容均以代码为准逐一核实，而非照搬最初的设计文档。`docs/` 目录下的旧文档（`ARCHITECTURE.md`、`IMPLEMENTATION_STATUS.md`、`DECISIONS.md`、`INSTALL.md`、`BACKUP_RESTORE.md`）描述的是项目早期"Milestone 1"阶段的状态，已经过时，请勿以其为准。

## 目录

- [系统功能概览](#系统功能概览)
- [架构](#架构)
- [功能详解](#功能详解)
- [联盟链接伪装（Affiliate Link Cloaking）](#联盟链接伪装affiliate-link-cloaking)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [命令行工具（CLI）](#命令行工具cli)
- [测试](#测试)
- [项目结构](#项目结构)
- [运维注意事项](#运维注意事项)

## 系统功能概览

一个小团队可以在一个地方管理大量静态联盟/PBN 站点：

- 从模板、上传的压缩包或本地目录创建新站点。
- 使用真正的"点击选中"可视化编辑器（文字、图片、样式、区块重排）、原始代码编辑器，或字段级 SEO 表单来编辑页面——三种方式最终都写入同一条基于 Git 的版本流水线。
- 将按钮、链接、图片标记为联盟推广元素（CTA）；按国家路由到不同目标链接（也可按站点单独覆盖），且页面源码中永远不会出现真实目标地址。
- 通过 Cloudflare 管理域名，分配服务器，并部署到 VPS 面板，自带 SSL 签发、上线冒烟测试，以及失败时自动回滚。
- 跟踪团队任务，通过站内或 Telegram 获得通知，并对每个站点的每一次改动保留完整审计记录。

## 架构

**Monorepo**（pnpm workspaces，`apps/*` + `packages/*`）：

| 包 | 作用 |
|---|---|
| `apps/web` | 后台管理应用——基于 Next.js 15（App Router），承载上述所有功能的界面。 |
| `apps/preview` | 独立的 Fastify 服务，以站点自己的源（origin）提供其原始文件，并在编辑模式下注入可视化编辑器的桥接脚本，以及联盟点击跳转脚本。 |
| `apps/worker` | 一个长驻 Node 进程：定期清理归档任务、发送截止日期提醒、轮询处理待处理的 aaPanel 自动导入任务。 |
| `packages/core` | 全部领域服务——站点、页面、版本、模板、部署、域名、联盟链接、脚本、任务、通知、认证等等。 |
| `packages/html-engine` | HTML 解析与补丁引擎（parse5 + Cheerio + magic-string）：SEO 字段提取、按源码区间打补丁、可视化编辑器的节点 ID 补丁引擎、联盟 CTA 自动打标。 |
| `packages/build` | `buildSite()`——把某一次精确的 Git 版本变成可部署的静态构建产物（脚本注入、sitemap/robots、canonical/hreflang、写死的联盟跳转脚本、"指纹"扫描、文件清单）。 |
| `packages/deployer` | 部署/服务商集成：aaPanel、CloudPanel（经 SSH）、Cloudflare、Vultr、Telegram、Nginx 配置生成器，以及本地发布 provider。 |
| `packages/templates` | 基于 Nunjucks 的模板渲染。 |
| `packages/shared` | Zod schema、权限矩阵、共享的错误类型与路径工具。 |
| `packages/ai`、`packages/integrations` | 仅有接口占位，背后尚无真实实现。 |

**持久化存储——在假设它用的是 Postgres 之前请先读这里：**

- 真正的数据来源是 **`state.json`**——`IGLE_DATA_DIR` 目录下的一个 JSON 文件，通过 `JsonStateStore`（`packages/core/src/state-store.ts`）读写。写入是原子的（先写临时文件再 rename），并由跨进程文件锁保护——这两项机制都是在真实生产事故之后加上的（一次是状态文件损坏，一次是两个 aaPanel 导入任务竞争同一个域名）。
- 每个站点的真实内容（HTML/CSS/JS/媒体文件，以及站点自己的 `.igle/*.json` 元数据）都保存在**它自己的 Git 仓库**中，路径为 `data/sites/{siteId}/repo`。每一次有意义的改动都是一次提交，并对应一条被追踪的版本记录——详见[运维注意事项](#运维注意事项)。
- **Prisma/Postgres 虽然存在于仓库中（`prisma/` 目录、Docker Compose 里的 `postgres` 服务），但运行时完全没有被使用**——没有任何代码导入 `@prisma/client`。请将其视为遗留的脚手架代码。
- **Redis 出现在 `docker-compose.yml` 中，`REDIS_URL` 也会被 worker 读取，但实际上没有任何代码真正连接它**——BullMQ 是一个依赖项，但代码中没有任何地方实例化 `Queue`/`Worker`。worker 实际上是用普通的 `setInterval` 轮询循环来实现的。

## 功能详解

**站点管理**——可创建空白站点、从模板创建，或导入压缩包/目录。每个站点可单独设置域名、URL 风格、HTTPS、语言/区域/地理位置（GEO）、分类（`affiliate` 或 `pbn`）、部署目标、favicon、sitemap/robots 行为、"域名嫁接"式的 canonical + hreflang，以及联盟链接覆盖设置。页面支持回收站（软删除/恢复/彻底清除），站点支持带二次确认输入的硬删除，另提供"将语言应用到全站所有页面"和"修复站内链接"等全站工具。

**模板**——内置模板库，也支持上传自己的静态 HTML 压缩包作为自定义模板（每个 `.html` 文件都会成为一种页面类型；站内链接会被改写为 CMS 的干净 URL 结构；标题/描述会被转换为 Nunjucks 占位符；联盟 CTA 会在导入时自动打标）。也可以用新的压缩包原地更新某个模板，且不会影响已经基于旧版本创建的站点。

**页面编辑**，三种编辑方式共用同一条版本流水线：
- *SEO 字段*——标题、meta 描述、H1、canonical、robots、OG 标签、`<html lang>`、是否纳入 sitemap——每个字段都单独跟踪自己的状态（继承 / 显式设置 / 手动编辑 / 有歧义），因此 CMS 永远不会悄悄覆盖你手动改过的内容。
- *代码编辑器*——编辑页面自身的原始 HTML（页头/页脚是全站统一编辑一次的，这里不包含）。
- *可视化编辑器*——在实时 iframe 中点击某个元素即可选中它。双击文字即可原地编辑，或打开富文本/原始 HTML 面板编辑整个区块。替换图片（会自动同步到站内其他使用同一图片的地方）。将某个区块在同级元素间上移/下移、复制、删除。样式控件（文字/背景颜色、边框、圆角、内边距、阴影、字体、文本对齐/大小写转换、字间距、悬停态）均以 `!important` 方式写入，以确保能可靠覆盖模板自身的 CSS。可将某个链接、按钮或图片标记为联盟 CTA（刻意**不**对整个区块/容器开放此功能——原因见下文）。支持撤销/重做、放弃改动、全屏模式，以及一键将本页的页头/页脚同步到全站其他页面。

**版本管理**——每个站点一个 Git 仓库；每次保存都是一次提交，并带有来源标签（可视化编辑器、代码编辑器、导入、模板、批量编辑等 25 种以上来源）。可以对任意两个版本做真实的 diff 对比。恢复某个历史版本会产生一个**新**提交——历史记录永远不会被改写。完整性检查会确认每条被记录的提交确实存在，且 `HEAD` 与最新版本一致。

**部署**——先构建一次（`buildSite()`），再发布到本地发布目录、aaPanel（通过其 REST API）或 CloudPanel（通过 SSH + `clpctl`，因为它没有 REST API）。每条路径都会：上传构建产物、签发 SSL、执行上线冒烟测试；对本地部署而言，若冒烟测试失败会自动回滚到上一个发布版本。部署某个站点时，如果它有镜像伙伴站点，也会一并部署。

**域名**——通过 Cloudflare 接入域名（创建 zone、添加代理记录、将 SSL 模式设为 `full`），跟踪生效进度，随后通过所分配的面板签发真实的源站证书，并将 Cloudflare 切换为 `strict` 模式。支持配置多个独立命名的 Cloudflare 账号，且刻意保持彼此隔离。

**SEO 工具**——sitemap/robots 生成、站点级 canonical"域名嫁接"、hreflang（可显式指定目标，也可基于镜像站点对自动互相生成）、全站默认 meta-robots，以及基于文件的 Google 站长工具 / Bing 站长工具验证（带实时可达性检查）。

**脚本**——每个站点可配置自定义 `<script>` 片段（插入位置、生效环境、页面范围、启用/禁用），内置 GA4/GTM 预设，并可检测重复的跟踪 ID。

**镜像站点**——将某个站点的完整内容复制到另一个 `SiteRecord` 下，用不同的域名/canonical/hreflang 配置运行同一份内容。可以连接、重新同步或断开一对镜像站点；部署时会在这对站点间自动级联。

**任务管理**——一个轻量级的、全团队可见的任务系统：优先级、状态、截止日期、评论、带独立指派人的检查清单、文件附件，以及完整的操作日志。已完成任务的每周自动归档、以及每个截止日期只提醒一次的到期提醒，均由 worker 负责执行。

**通知**——站内通知始终会被写入；Telegram 推送是一个"失败也静默"的附加渠道（共用一个 bot token，每个用户各自绑定自己的 chat ID）。

**团队与认证**——全团队共用一个密码，外加每个用户强制启用的二次验证（TOTP，附带一次性备份验证码）；两种角色（管理员 / 编辑）搭配一张明确、精简的权限矩阵——不提供按站点单独授权的机制。另有一道"受限服务器"的门槛，仅对联盟站点生效；PBN 站点按设计会绕过这道限制。

**服务器**——注册 aaPanel 或 CloudPanel 服务器，可将其标记为受限，并且（针对 aaPanel）可让 worker 在后台自动导入该面板上已有的所有站点，并将每个站点识别为静态、WordPress、MODX 或通用 PHP 动态站点，以避免动态站点被一份过时的静态快照悄悄覆盖。

**重定向、媒体与 Vultr** 完善了整套工具箱：站点级 301/302 重定向（防循环、防多级跳转链）、图片上传处理，以及只读的 Vultr 实例发现功能，用于自动填充新服务器的 IP 地址。

## 联盟链接伪装（Affiliate Link Cloaking）

这是最值得深入理解的一个子系统，因为它的设计是刻意为之、并不直观的。

**有一条规则绝不能被打破：真实访客的点击永远不会经过 CMS 自己的服务器。** 早期版本的这个功能会让每一次点击都实时经过 CMS 托管的一个跳转接口查询目标地址。这个设计后来被替换掉了——把流量都引导经过同一个、可被识别指纹的来源，会把所管理的每个站点重新关联到一起，这恰恰违背了运营一批彼此独立站点的初衷。为此接受的取舍是：更改链接只会在该站点**下一次部署**时生效，而不是立即生效。

完整的工作流程：

1. **打标**——`tagAffiliateCtas()` 会在模板上传和站点创建时自动识别 CTA 锚点（形如 `#` 的死链接、`rel="sponsored"`、已知的 CTA class，或已有的动态链接标记），将其标记为 `data-igle-cta="<slot>"`，并清除 `href` 中已存在的真实目标地址，确保它不会出现在原始 HTML 中被抓取到。它刻意**不会**仅凭一个外部链接就去猜测——一条真实的合规/监管链接绝不能被误伪装。
2. **手动标记**——在可视化编辑器中，"标记为联盟链接"会将选中的元素包裹进一个全新的 `<a data-igle-cta>` 中。此功能只在链接、按钮和图片上提供——绝不提供给某个区块或其他容器，以免不小心把整个页面区块都变成一个巨大的链接。
3. **路由**——管理员在"集成"页面为每个国家设置一个目标地址；某个站点也可以用自己的链接覆盖它。解析顺序为：站点覆盖 → 国家默认值 → 未配置任何内容。
4. **写死（Baking）**——在部署时，解析出的目标地址会作为字面字符串直接写死进一个小型点击跳转脚本中，同时 `data-igle-cta` 会在最终产物中被重命名为中性、不带 CMS 品牌痕迹的 `data-go` 属性。构建流程中的"指纹扫描器"会拒绝最终文件中残留任何 CMS 标记,这正是即便尚未配置任何链接,也要无条件执行这次重命名的原因。
5. **点击时**——`document` 上挂一个委托监听器，以 `data-go` 为选择依据；命中时拦截点击，跳转到写死好的目标地址,完全在客户端完成,就在站点自己的域名下。不会向 CMS 发出任何请求。
6. **在 CMS 自己的预览环境中**，同一个脚本也会被注入（这里以尚未重命名的 `data-igle-cta` 为选择依据），这样在真正部署之前就能实际测试一个已标记的 CTA 是否可用。

## 技术栈

- **Next.js 15** / **React 19**，全程 TypeScript，共用一份严格的 `tsconfig.base.json`。
- 所有 schema 均使用 **Zod**；HTML 编辑采用 **parse5 + Cheerio + magic-string**，按源码区间精确打补丁（绝不做盲目的整体重新序列化）。
- 预览服务使用 **Fastify**；后台应用的 API 则是普通的 Next.js 路由处理器。
- **`bcryptjs` + `otpauth`** 用于密码哈希与 TOTP 二次验证；**`ssh2`** 用于 CloudPanel 基于 SSH 的部署；**`nunjucks`** 用于模板渲染；**`@tiptap/*`** 用于可视化编辑器的富文本面板；**`qrcode`** 用于生成二次验证的二维码。
- Git 相关操作直接调用系统自带的 `git` 命令（版本、diff、恢复、构建物化），而不经过某个 JS 的 Git 库。
- 以 **Docker Compose** 形式交付：`web`、`preview`、`worker`、`postgres`、`redis`，以及作为反向代理的 `caddy`——具体哪些服务在当下真正承担实际负载,请参见上文的持久化说明。

## 快速开始

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install
cp .env.example .env   # 设置 ADMIN_EMAIL / ADMIN_PASSWORD 以初始化第一个管理员账号
pnpm dev                # apps/web 运行在 :3000
pnpm dev:preview         # apps/preview 运行在 :3001（另开一个终端）
pnpm dev:worker          # apps/worker（另开一个终端——任务清理、aaPanel 自动导入）
```

真正在运行时会被用到的环境变量：

| 变量 | 用途 |
|---|---|
| `IGLE_DATA_DIR` | `state.json`、每个站点的 Git 仓库、发布目录与构建产物的存放位置。 |
| `WEB_ORIGIN` | 后台应用自己对外的公开地址——用于 Telegram 深链，且必须是一个真实、可公网访问的地址（而非 `localhost`），否则任何已部署站点的跳转脚本以及预览链接都无法正常工作。 |
| `PREVIEW_ORIGIN` | 预览服务的地址。 |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | 仅首次运行时生效——用于初始化第一个管理员账号及团队共用密码。一旦已存在任意用户，则不再生效。 |
| `AAPANEL_BASE_URL` / `AAPANEL_API_KEY` | 可选——首次运行时自动注册一个旧式的 aaPanel 服务器。正常情况下应通过"服务器"页面添加新服务器。 |

`.env.example` 中还存在 `DATABASE_URL`、`REDIS_URL`、`BETTER_AUTH_SECRET`，它们是为 Docker Compose 中对应的服务而配置的，但应用代码本身并不依赖它们——详见[架构](#架构)一节。

### Docker

```bash
docker compose up --build
```

所有 CMS 的持久化数据（状态文件、每个站点的仓库、发布产物、构建产物、任务附件）都存放在 `igle-data` 这个卷中，挂载到 `web`、`preview`、`worker` 容器内的 `/data` 路径。

## 命令行工具（CLI）

```bash
pnpm igle setup-admin --email admin@example.com --password 'change-me'
pnpm igle create-blank-site --name "Demo" --slug demo
pnpm igle import-directory --site demo --source fixtures/site-basic
pnpm igle list-sites
pnpm igle dedupe-sites [--confirm true]   # 清理因同一个 aaPanel 服务器被重复导入而产生的重复站点
pnpm smoke
```

## 测试

```bash
pnpm -r typecheck   # 对每个包/应用执行严格的 TypeScript 类型检查
pnpm test           # Vitest —— build、deployer、domain-service、html-engine、permissions、revision-import、state-store、template-builder
```

## 项目结构

```
apps/
  web/        Next.js 后台应用 —— 全部页面与 API 路由
  preview/    Fastify 服务 —— 提供站点原始文件 + 可视化编辑器桥接脚本
  worker/     后台定时任务（任务清理、aaPanel 自动导入）
packages/
  core/       领域服务（站点、页面、版本、部署、域名、联盟链接、任务、认证……）
  html-engine/  HTML 解析、打补丁、SEO 提取、联盟 CTA 打标
  build/      将一次 Git 版本转换为可部署的静态构建产物
  deployer/   aaPanel、CloudPanel、Cloudflare、Vultr、Telegram、Nginx、本地发布 provider
  templates/  基于 Nunjucks 的模板渲染
  shared/     Zod schema、权限矩阵、错误类型
  ai/         接口占位 —— 尚无实现
  integrations/  接口占位 —— 尚无实现
templates/    内置站点模板
fixtures/     测试用固定数据
scripts/      igle.ts 命令行工具、冒烟测试、启动脚本
docker/       Dockerfile 与 Caddy 配置
tests/        Vitest 测试套件
```

## 运维注意事项

- **基于节点 ID 的 HTML 打补丁机制**——可视化编辑器从不对整个页面重新序列化。每个元素仅在编辑期间被临时赋予一个 `data-igle-node` ID；补丁通过该 ID 定位元素，并以精确的源码区间覆写方式应用，因此未被改动的标记内容（包括手写的格式）都会被逐字节保留。
- **"指纹"扫描器**会把构建产物最终输出中任何残留的 CMS 标记（如 `data-igle-`、编辑器桥接脚本等）视为构建硬错误直接拒绝——这就保证了任何编辑用的痕迹都不会流出到真实上线的公开站点中。
- **内容锁定**——如果某个站点是从 aaPanel 自动导入的，且被识别为 WordPress、MODX 或其他 PHP 动态站点，会被自动锁定，不允许通过 CMS 继续编辑或部署，因为 CMS 手上拿到的始终只是一份过时的文件快照，部署这份快照有可能覆盖——在 CloudPanel 上甚至会直接删除——真实在线运行的站点。管理员手动设置的锁定/解锁状态，始终优先于后续自动检测的结果。
- **受限服务器仅对联盟站点生效**——编辑角色的用户无法部署到、或将域名分配到被标记为受限的服务器上,但 PBN 分类的站点无论操作者是谁都会绕过这道限制。
- **站点级写锁**——对同一个站点的编辑会在进程内被串行化，以防止两个几乎同时发生的改动相互竞争，导致其中一个被悄悄丢弃。这个锁只存在于内存中，如果未来把应用横向扩展为多个 `web` 实例，该锁并不会跨实例生效。
- **`state.json` 的原子写入与跨进程文件锁**是为了应对两次真实发生过的生产事故（一次是状态文件损坏，一次是两个 aaPanel 导入任务在同一个域名上发生竞争）——如果你要改动它的写入方式或写入频率，请记住这一点。
- **aaPanel 自动导入**运行在后台轮询中，内置断路器进行自我限速，并能在 worker 崩溃或重启后，自愈任何被遗留在"运行中"状态的导入任务。
