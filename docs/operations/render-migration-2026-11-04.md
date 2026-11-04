# Render Node 候选站：部署准备与验证

用户选择每月约 5–10 美元并优先稳定运行。本轮基于性能优化提交 `7d73f77` 准备 Render 候选配置，未创建收费资源、部署、切换域名或修改原 Vercel 账户。

## 方案与预算

- 一个 Singapore Web Service，Node 24，`0.5c-512mb`（0.5 CPU/512MB），当前基础计算价格约 **7 美元/月**。不是总费用保证，工作区带宽/构建等计量、税费和既有外部服务另外核对。[价格](https://render.com/pricing)、[Blueprint 规格](https://render.com/docs/blueprint-spec)。
- 自动部署、自动预览均关闭，固定一个实例，无数据库、磁盘、额外定时任务或付费附加资源。
- 使用当前 Next 16.4.3 的普通 Node 模式与 `next start`，保留现有 Cloudflare 数据/执行器服务；不引入适配器重写。Render 构建限制为两个 Next worker，避免开发机 CPU 数决定构建并行度。
- 当前候选为完整 Git checkout，保留全部数据和所有台账引用 receipt。JSON 和证据仍严格核验，上海日期/到期规则仍在每次公共快照选择时执行。

## 变更的数据流

```text
Git checkout + 全部 receipt
  → 构建前严格目录完整性验证 → Next webpack production build
  → 启动前严格验证（独立进程，完成即退出）
  → 一个 Next Node 服务：0.0.0.0:$PORT
       ├─ 公共页面/API：原严格实例缓存 + 上海日期失效
       ├─ /api/health：严格公共目录就绪，200/503，no-store
       └─ 管理端：认证/private/no-store/分布式限流
```

`RENDER_EXTERNAL_URL` 为未设置自有域名时提供 canonical 与可信来源，Render 部署要求 HTTPS；不信任任意 Host/forwarded-host。release SHA 支持 `RENDER_GIT_COMMIT`，保留 Vercel 原有优先级与格式校验。Render 环境即使误开本地执行 opt-in，也不能启动本机核验子进程。

构建和启动包装脚本强制候选使用已核验 Git JSON、预览关闭、本地执行关闭、远程控制关闭、发布控制关闭。**这是一套候选站配置，不是已经完成所有后台发布功能的正式切换。** 生产仍使用 distributed 登录限流，重用既有 Upstash。CLI 本地测试的 memory 限流只是合成登录 fixture，不写入生产 Blueprint。

## 账号与当前外部阻塞

用户已完成 Render 插件连接；插件状态已确认 installed=true。但只读读取工作区/服务时，后端多次返回 `Unknown tool`（`render.list_workspaces`、`render.get_selected_workspace`、`render.list_services`），未能读取工作区、服务或账单设置。不能将此错误归因于用户没登录。

用户随后明确选择“只使用插件，暂不重复登录”。后续遵守该偏好；不继续浏览器登录或浏览器账户操作，不请求复制访问令牌。插件读取恢复后先确认目标工作区和现有服务，再创建具体候选服务。此时没有 Render service ID、部署 URL 或线上指标可以报告。

## 验证与内存证据

完整构建通过，日志 `render-evidence/build.log` 包含上海 2026-11-04 严格目录完整性通过；数据/receipt 未改动。当前公共目录大学278、项目989、奖学金7，现行事实大学262、项目753、周期753、奖学金0。完整性成功不表示全校覆盖，原 `coverageComplete: false` 保留。

目标环境/认证/缓存58项 Vitest 定向测试通过，另有3项 Node 启动/Blueprint 测试。类型检查和全库 ESLint 通过。完整回归 **243个测试文件、2174项通过、1项跳过**，日志在 `render-evidence/tests-full.log`。随后代理IP修复的44项安全定向测试、最终类型检查/ESLint与生产重建也通过，见 `proxy-security-tests.log` 与最终构建日志。

实际运行新的 start wrapper，在 Windows Node24.14.0 下为每个 Node 进程限制256MiB V8 heap。完成严格就绪、60次公共访问（6并发）、中英文/外部origin/Render提交SHA核对、未认证401/private/no-store、代理HTTPS Secure/HttpOnly/SameSite Cookie、登录/退出、跨站拒绝及 SSE 首条流式事件检查。

最终重建后的本地测量启动就绪约5.45秒；Next单进程峰值RSS约299.5MiB，包装进程约36.2MiB；100ms采样估计的同时运行进程RSS峰值约334.6MiB。独立校验进程峰值约174.1MiB，它先退出再启动Next，不能将所有阶段峰值相加作为常驻使用量。全部逐进程记录和限制说明见 `render-evidence/runtime-probe.json` 及 `.ndjson`。

**没有应用512MB硬内存限制。** 本机Docker Linux daemon未运行，未启动/安装它。Windows RSS、短时请求和256MiB V8 heap cap不能证明Linux cgroup/Render512MB实例长期稳定。这个结果支持进行候选验证，不构成512MB生产容量承诺；不得为通过测试删核验、放宽身份或延长过期日期。若云端内存不足，停止候选并重新评估预算内平台，不自动升级到预算外实例。

代理IP的定向安全修复：Render只从其文档规定的 `X-Forwarded-For` 获取客户端IP，忽略在此平台不可信的 `x-vercel-forwarded-for`/`x-real-ip` 替代头；缺失/无效则使用固定unknown桶，避免攻击者任意选择限流键。集成测试轮换伪造替代头仍命中同一桶，第六次请求429。Render之外的原行为保留。官方依据见 [真实客户端IP说明](https://render.com/articles/how-render-handles-ddos-attacks#reading-the-true-client-ip)。在实际候选站上仍需确认Render边缘对伪造XFF本身的覆盖/追加行为，再开放管理员使用；本地单元测试不证明云端代理链行为。

## 创建前需要的现有配置

`render.yaml` 的四个 secret占位要求重用已有配置：`ADMIN_ACCESS_TOKEN`、`ADMIN_SESSION_SECRET`、`UPSTASH_REDIS_REST_URL`、`UPSTASH_REDIS_REST_TOKEN`。不填假值、不输出密钥、无需创建新的Redis。缺少分布式限流配置时管理登录会拒绝，不能改成隐式内存降级。

需要保留原公共反馈/Turnstile/邮件/限流设置，以及只读远程遥测凭据时，按 `.env.example` 在平台secret界面复制既有值；不将核验模型密钥、本机CC Switch信息或本地执行器私有状态搬进网站。

`NEXT_PUBLIC_SITE_URL` 在有自有域名时于构建前设置；否则使用Render自动提供的外部URL。不要复制旧的 `VERCEL_*` 平台自动变量。当前 `studyinchina.vercel.app` 是平台域名，迁出需要新地址或自有域名。

## 云端候选验证与正式切换

1. 插件恢复后读取并由用户确认正确工作区；确认单服务计划/区域/基础价格及其他计量，创建前核对账号已有资源，避免重复。
2. 先推送/审查候选分支，再以 `render.yaml` 对应设置创建服务；自动部署关闭。连接GitHub仓库，设置既有secrets，用Render本身HTTPS地址构建。
3. 在新地址小范围读取 `/api/health`、current release、代表性列表/详情，核对SHA、评估日期、语言与到期字段。验证登录、Secure Cookie、CSRF、SSE流式传输及真实distributed限流。
4. 用Render插件读取memory usage/limit、CPU、实例数、p95响应、错误/重启/OOM事件，观察正常负载及至少一次上海午夜。没有该证据前不承诺512MB稳定或“迁移已完成”。
5. 正式切换前，替换Vercel专属发布/回滚writer、远端smoke域名白名单和旧健康检查地址，调整Turnstile允许域名、canonical/OG域名以及可选Vercel监控。保持旧writer的精确项目/域名授权边界，不直接放宽为任意URL。
6. 确认新平台发布与回滚闭环后，再启用相应后台控制和正式域名入口。当前候选不开放这些控制，避免把Render管理操作错误发送到旧Vercel部署。

候选阶段无需切DNS；失败直接停止候选，原数据和审核证据保持。正式切换后通过Render已验证的上一代码部署回滚，再核对事实与日期，不能回滚真实数据来掩盖问题。Render侧的停止/删除必须通过已授权账户能力执行并确认停止计费，不能把本地文件删除当作资源清理。

## 复现入口

```powershell
npm ci --include=dev
# 本地模拟平台环境（不能省略合法HTTPS外部地址）
$env:RENDER_EXTERNAL_URL='https://studyinchina-candidate.onrender.com'
$env:RENDER_GIT_COMMIT='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
node scripts/hosting/build-render.mjs
node --test scripts/hosting/render-runtime.test.mjs
node scripts/hosting/probe-render-runtime.mjs docs/operations/render-evidence/runtime-probe.json
```

最后一项只发起本地请求，使用随机合成凭据，不访问线上API或创建任何资源。将TEMP/TMP设为worktree `.tmp`可避免Windows测试工具临时目录权限问题。与VercelCPU优化数据的比较结果仍在之前的Fluid报告中，迁移本地probe不能替代新平台CPU/内存实测。
