# Vercel Fluid Active CPU 优化结果

本轮完成实现和本地验证，尚未部署。生产别名现场仍为 `402 / DEPLOYMENT_DISABLED`；优化不清除已累计用量，也不解除暂停。没有升级套餐、产生新基础设施费用或修改账户。

## 核查与实现

现场远端默认分支仍是 `c93a6cad17df5fc006e9fef69976cd4e5d08e79a`（PR #75）。原工作区是 `87751c9` 且有大量未提交改动，因此实现位于独立的 `codex/fluid-cpu-cache` worktree，没有覆盖原工作。

当前身份台账 1,336 条、938,184 bytes，引用 63 个不同 receipt；六份原始 JSON 合计 12,253,332 bytes。既有 `bundlePromise` 已避免同实例原始 JSON 反复读取解析；本轮针对其下游独立请求重复执行的严格核验、公开投影和 revision 工作。

代码证实这些重复工作存在，本地基准证实能够减少 CPU；现有证据不足以认定它们占生产 CPU 的具体比例。各路由、机器人、预取、批量验证和冷启动的实际占比仍未知。[设计与证据边界](fluid-cpu-design-2026-11-03.md)、[部署审计](fluid-cpu-deployment-audit-2026-11-03.md)、[验证范围审计](fluid-cpu-validation-scope-2026-11-03.md)分别记录细节。

实现后的流程：

1. 每次访问检查原始文件、台账及关联 receipt 的元数据依赖，包括缺失文件和真实路径；变更时重新解析、严格校验。读到变化中的代会重试，失败不缓存，也不回退到旧的严格公开结果。
2. 原始快照、严格身份快照、字段快照和 `Asia/Shanghai` 日期共同确定公共快照。命中不再序列化/哈希整个目录来寻找键。首次或失效时才生成 current、directory 和 revision。
3. 公共快照递归冻结；原始与预览数据独立分支。新部署/新实例各自初始化；同步初始化在单个 isolate 中串行，异步自定义 loader 保留 Promise 去重与失败恢复。
4. 公开页仍按请求进行语言显示、筛选和渲染；API 先分页再生成当前页字段元数据。来源查找与身份索引在适当作用域复用，所有名称、来源、receipt 和日期资格门槛保留。
5. JSON release 与计数取自同一原始代。响应缓存头检查 payload 的评估日期，防止跨上海午夜为昨日数据授予今日 TTL。认证/管理/通知保持 private/no-store。D1/shadow 的远端更新契约不新增本地投影缓存。

公共语言布局的 `connection()` 与详情动态边界保留。安装的 Next 16.4.3 文档及实际 HTTP 响应均确认 HTML 仍为动态 `private, no-cache, no-store`。本轮数据缓存减少函数内部计算，**未取得 HTML/CDN 避免函数执行的新增收益**。公共 API 仍返回受上海午夜约束的共享缓存头；本地服务器没有 CDN，不能据此确认 Vercel HIT。

线上 smoke 改为远端默认 `changed`：变更事实、关联学校、未变更哨兵、全部变更语言、移动端、导航和过期 404 检查保留。`full` 仍是本地默认并可显式用于远端。只证实历史上至少一对重复全量 candidate/stable 回读，未推断近期次数或 CPU 占比；没有实际向暂停生产执行 smoke。

## 相同条件的测量

平台 Windows，Node 24.14.0，Next 16.4.3，锁定依赖 `npm ci --ignore-scripts`。所有前后数据哈希均为 `92a43005d86e7e9354f683004dfed26e881f06bc319da4cf8716816f5e59fc7e`，评估日期均为上海 `2026-11-03`。未修改数据文件或 receipt。

计算基准每个场景在新进程执行：首次 1 次、连续 10 次、并发 8 次；CPU 使用 `process.cpuUsage`，墙钟使用 `performance.now`。包括相同的结果序列化/摘要消费，模块导入成本位于首次计时之前。四个场景所有结果 SHA256 前后一致。

| 计算场景 | 首次 CPU 前→后 ms | 热请求 CPU 前→后 ms/次 | 热请求墙钟前→后 ms/次 | 热并发 CPU 前→后 ms/次 |
| --- | ---: | ---: | ---: | ---: |
| 页面目录数据 | 640→578 | 376.6→37.5 | 327.0→37.3 | 388.6→35.1 |
| 目录 API + 首页面投影 | 813→671 | 503.1→51.6 | 480.2→50.0 | 503.9→44.9 |
| current release/revision | 656→501 | 459.3→13.9 | 425.3→13.6 | 509.9→13.8 |
| repository 目录列表 | 907→593 | 446.9→25.0 | 439.8→17.3 | 500.0→17.6 |

生产 HTTP 基准在新启动的本地 Next production server 上顺序执行六条相同路由，每条首次 1 次、连续 5 次、并发 4 次，共 60 次。IPC 在服务器进程中读取 CPU，客户端 HTTP 延迟只作墙钟记录，未当作 Active CPU。两次均使用 `next build --webpack`；构建基线已包含午夜缓存头修复，但尚无缓存/索引/分页优化，日间头行为一致。

| HTTP 路由 | 热请求 CPU 前→后 ms/次 | 降幅 | 热批次墙钟/请求 前→后 ms | 热并发 CPU 前→后 ms/次 |
| --- | ---: | ---: | ---: | ---: |
| `/en/universities` | 509.2→62.6 | 87.7% | 447.4→36.0 | 504.0→47.0 |
| `/zh/universities` | 584.4→37.4 | 93.6% | 550.5→31.4 | 539.0→39.3 |
| `/en/universities/tsinghua-university` | 303.2→28.2 | 90.7% | 263.8→22.5 | 277.3→42.8 |
| `/zh/universities/tsinghua-university` | 231.2→37.6 | 83.7% | 224.2→23.2 | 234.3→31.0 |
| `/api/v1/directory/programs?limit=24` | 512.4→52.8 | 89.7% | 472.8→48.7 | 468.8→47.0 |
| `/api/v1/releases/current` | 274.8→6.2 | 97.7% | 272.7→8.6 | 304.5→7.8 |

六路由等权热请求 CPU 平均 402.5→37.5 ms（下降约 90.7%）；整个 60 请求集包含首次和并发，CPU 合计 24,812→2,891 ms（下降约 88.3%）。这是这个请求集的结果，**不是生产加权结果**。

新服务器第一个请求 `/en/universities` 的 CPU 1,220→750 ms，墙钟 943.6→564.9 ms；严格初始化成本仍显著。后续路径的“首次”共享已经初始化的模块/数据，不能全部称为独立冷启动。HTTP 前后 60 次响应均 200，语言属性、响应字节数相符；HTTP 未保存全文哈希，内容语义另外由集成测试及计算基准全输出摘要验证。

原始 JSON 记录每批 heapUsed 差值。首个 HTTP 请求 heap 增量约 137.4→52.7 MB；热批次可为负数，因为 GC 回收会穿插执行。这不是稳定驻留内存或峰值测量，不能据此承诺内存降幅。缓存会保留原始/证据/公共结果，实际实例 RSS 仍需线上观察。

原始记录在 [fluid-cpu-evidence](fluid-cpu-evidence/)；[comparison.json](fluid-cpu-evidence/comparison.json)汇总首次、热请求、并发、CPU、墙钟与 heap 差值。中间 profile 曾揭示字段元数据处理热点，最终通过先分页再投影消除；最终数字来自所有测试结束后的串行复测。

## 验证结果

- 完整单元测试最终 **241 文件通过，2,158 项通过，1 项跳过**，见 `tests-final.log`。首次沙箱运行有 20 项文件 link/junction 权限失败及 1 项旧缓存契约断言；无沙箱重跑与完整最终运行通过。旧 fixture 补充评估日期，并新增缺失日期不缓存断言。
- `npm run typecheck`、`npm run lint`、`npm run build -- --webpack` 通过。构建生成 937 个静态输出；公共列表/详情依然是动态路由，不能把静态输出总数当作公共 HTML 缓存证据。
- 新缓存测试覆盖并发首次初始化（20 请求只解析一次）、异步失败突发后的恢复、数据同大小原子更新、数据损坏恢复、receipt 修改/删除/修复、严格/宽松读取隔离、字段台账创建/损坏/修复、上海午夜、记录与截止日期到期、字段独立到期、嵌套污染防护、多语言名称与暖预览/认证隔离。
- `validate:directory` 完整性通过；真实日期下目录大学 278、项目 989、奖学金 7，现行事实大学 262、项目 753、年度周期 753、奖学金 0。报告同时明确 `coverageComplete: false`，没有宣称全校覆盖。
- `validate:data` 仍因原始数据中既有 verified 记录超过 reviewAfter 而失败。数据无 diff；这些逾期记录继续被公开投影隔离/降级，没有延长日期以通过检查。这是后续数据维护事项，见 `validate-data.log`，不能把完整构建通过写成数据健康全绿。

## 能否保持团队每天约 5–6 分钟

用户控制台数据：StudyInChina 近期约 40 CPU 分钟/日，即 30 天约 20 小时；团队目标 5.6 分钟/日，即 30 天 2.8 小时，需约 86% 降幅，且要为其他项目留空间。以下均为情景推算，未取得新的 Vercel 实测。

推荐按路由计算：

```text
30天团队CPU秒 = 30 × [ Σ路由 (日函数执行数 × 每次CPU秒)
                      + 日初始化次数 × 额外初始化CPU秒
                      + 验证/定时任务CPU秒 + 其他项目CPU秒 ]
```

函数执行数需从真实调用/缓存命中推导；CDN 命中后的函数开销、proxy、未优化路由不能假定为零。将初始化成本单列时，热请求项不能再次包含同一冷启动开销。机器人和预取均计入真实执行数。

若以旧 StudyInChina 40 分钟/日、此次等权热请求比例 r=0.0931 作示例，并假设其他项目延续过去 30 天约 3分25秒（约 0.11 分钟/日）：

| 旧CPU中具有相同优化比例的份额 f | StudyInChina 分钟/日 = 40×[(1−f)+f×r] | 加其他项目后的30天团队CPU |
| --- | ---: | ---: |
| 100% | 3.72 | 约1.92小时 |
| 95% | 5.54 | 约2.83小时 |
| 80% | 10.98 | 约5.55小时 |

该模型还未加入实际初始化频率增加、负载增长和 route mix 差异。若冷请求较热请求多约 0.71 CPU 秒，18,000 次函数执行/日中 1% 需要独立初始化，则额外约 128 秒（2.1 分钟/日）；这是演示敏感性，不是实测冷启动率。以 17,966 次/日计算，5.6 分钟扣去其他项目后只允许 StudyInChina 平均约 18.3 ms/执行；29,639 次/日则约 11.1 ms。不同硬件上的本地绝对 ms 不可直接套用 Vercel。

因此不能承诺已经达标：在上述理想热请求比例下，也需约 95% 的旧 CPU 都得到相同收益，才接近 5.6 分钟，冷启动会进一步收紧。若直接采用包含首次的 60 请求集比例 0.1165、且全负载都同等改善，则示例团队约 4.8 分钟/日；这仍只是一种流量假设。

已测量的是本地函数内部 CPU、HTTP/墙钟、输出一致与失效正确性；新增 CDN 收益、线上真实降幅、smoke 实际节省量和团队预算达标均尚未测量。

## 发布、观察、回滚

本轮仅交付可审查变更，没有发现本会话已有生产部署授权，未推送、部署或提升别名。原有部署/alias 安全流程保留。服务恢复需要单独处理团队暂停状态；暂停期间失败请求、零用量和低流量均不作为成功证据。

恢复后按小时保存路由级执行数与 Active CPU（避免再次丢失短窗口），至少观察正常负载的 24–72 小时和一次上海午夜。记录：CPU秒/日及每千次执行、CPU最高路由、首次初始化比例/时间、p50/p95墙钟与错误率、内存/RSS、API实际 `x-vercel-cache`/Age/HIT/MISS、机器人/预取与验证任务请求数、评估日期/目录 revision。午夜、receipt 更新和 release 部署后，抽查失效与审核范围，检查管理/认证/通知 private/no-store。

先确认日预算及正常访问量，再按真实路由加权外推30天；若超过5.6分钟，优先处理贡献最大的残余路由，下一阶段设计可严格跨午夜失效的公共响应缓存/静态壳，并用真实 HIT 证明函数执行减少。

回滚使用原项目部署流程恢复上一代码部署；本地撤销本轮代码后重启进程以清空实例缓存。只回滚性能代码，不回滚事实、receipt 或审核日期。回滚可能恢复较高 CPU，需要缩小生产抽查范围并继续观察。本轮没有引入外部缓存需要清理。

## 复现

在本轮 worktree 中执行安装、类型检查、lint、测试与 webpack 生产构建。Windows 测试将 TEMP/TMP 指向 worktree 的 `.tmp`；需要文件 link/junction 权限。

```powershell
node --conditions=react-server --import tsx scripts/quality/benchmark-fluid-cpu.ts page-data output/page-data.json
node --conditions=react-server --import tsx scripts/quality/benchmark-fluid-cpu.ts directory-api output/directory-api.json
node --conditions=react-server --import tsx scripts/quality/benchmark-fluid-cpu.ts release output/release.json
node --conditions=react-server --import tsx scripts/quality/benchmark-fluid-cpu.ts repository-list output/repository-list.json
node scripts/quality/benchmark-fluid-http.cjs output/http.json
```

HTTP 输出的父目录需预先创建。复测旧版本应使用另一独立 checkout 的 `c93a6ca`、相同锁定依赖/数据/receipt/上海日期，复制相同基准脚本，串行运行且不要同时构建或测试。单次基准样本量较小、Windows CPU 计时有粒度误差，GC/JIT和后台负载会影响结果；初次计时不等于完整平台冷启动。本地复用不证明多实例或 CDN 行为，也不等于 Vercel 计量。

交付位置：`D:\学过的课程\github_profile_work\StudyInChina-fluid-cpu`，分支 `codex/fluid-cpu-cache`。基准在原临时嵌套目录中完成后，工作树整体移至同级目录，避免原工作区编译递归扫描；代码、数据和结果未改变。
