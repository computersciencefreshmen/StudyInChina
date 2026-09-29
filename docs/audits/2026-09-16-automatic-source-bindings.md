# 自动官方来源绑定回填

日期：2026-09-16。

## 解决的问题

自动登记 source 只使 Worker 可以抓取页面。实体物化还要求存在官方 source_document、publication_source_metadata 和 promotion_source_binding；此前自动种子及发现页面缺少这一桥接，已抓取的候选会反复等待配置。

新增 `workers/ingestion/src/automatic-source-bindings.ts`，在每轮 ingestion 调度的来源登记之后回填。它不改 provider 工作流状态，不生成项目事实，不生成字段映射，也不改 verifiedAt。实体物化与发布器继续执行原有门禁。

## 绑定条件

- 来源必须是合法的 auto-seed 或 auto-discovery ID，启用并遵循 robots。
- 只接受学校目录、招生页、项目页和学校奖学金；contacts、政府奖学金与手工来源不自动绑定。
- 学校必须有已登记的 organization 和 institution，且身份处于 validated/applied/published/stale 状态。
- 来源与最终重定向页面的 hostname 必须分别与机构官网、招生入口、organization_domains 或该机构已有有效官方 source_document 的主机精确匹配。相同 edu.cn 后缀不足以授权。
- 必须存在真实 ingestion_snapshot；重新读取 R2 正文，比对字节数、SHA-256、快照 ID、对象键及 sourceId/fetchedAt 等不可变元数据。
- 同一 URL 被其他学校声明时不绑定，现有 publisher 不覆盖。
- 写入同一 D1 事务，只使用 INSERT OR IGNORE；写前重新检查来源启用状态、manifest、机构归属和主机信任依据。人工停用的绑定或来源文档不会自动恢复。

发布 metadata 的 reviewed_at 使用真实快照抓取时间，仅表示来源绑定依据的检查时间，不给项目字段增加核验时间。来源标题采用 URL 标签，避免把未经审核的页面标题当成项目名。

## 执行与边界

默认每轮最多 25 个来源，调用者最多可指定 100。按学校分组轮换并随机选择，使固定失败的来源不会永久占据队首。基础设施故障会使心跳失败；证据/政策不满足只记录 deferred 原因并继续其他来源。

精确主机尚未在独立机构登记表出现的来源会继续等待，不依赖 seed 自身 allowlist 自我授权。现有停用绑定直接排除。没有事实字段映射的候选仍须由原有实体物化路径生成合法映射。

## 验证

- 新增 10 项 SQLite 测试：正文缺失/损坏、错误来源/大小/键/时间、精确主机、跨校 URL、停用绑定、已有人工 metadata、并发停用/改 manifest/改校属/撤销域名、R2 故障以及幂等性。
- 验证所有路径不写 claims、canonical_fields、change_sets、promotion_field_mappings，机构 records 不变化。
- 新测试、来源发现和成本策略共 26 项通过；TypeScript、目标 ESLint 与 diff 检查通过。
- 远端部署和实际回填结果由根代理记录，本报告不将本地测试等同于云端已生效。
