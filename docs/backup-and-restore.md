# Cloudflare D1 备份与恢复演练

## 目标与边界

生产数据库的恢复目标为 `RPO <= 24 小时`、`RTO <= 4 小时`。每日备份保留 35 天，每月副本保留 370 天（覆盖 12 个完整月及闰年差异）。备份和演练都不得把申请人个人资料写入仓库或 CI Artifact。

`.github/workflows/cloudflare-backup.yml` 每日执行以下操作：

1. 使用 Cloudflare 只读/备份权限枚举普通数据表，并导出 `studyinchina-catalog` 和 `studyinchina-pipeline` 的数据。
2. 生成 `catalog.sql.gz`、`pipeline.sql.gz` 和 `backup-sha256.txt`。
3. 上传到私有 R2 的 `backups/daily/YYYY-MM-DD/raw-v1/` 和 `backups/monthly/YYYY-MM/raw-v1/`。专用 Bucket 为 `studyinchina-backups`。
4. The workflow reads the three daily objects back from R2 and revalidates gzip and SHA-256; only a successful readback creates an RPO checkpoint.

`raw-v1` 是原始字节格式的版本标识。两个 `.sql.gz` 对象必须同时写入
`Content-Type: application/gzip` 和 `Content-Encoding: identity`；否则 Wrangler
可能在读回时透明解压，导致读回内容与上传文件的 SHA-256 不一致。旧的无
`raw-v1` 对象不能作为有效恢复点，也不能被恢复演练自动选用。

R2 生命周期由 `npm run cloudflare:retention` 配置。备份 Token 应只具备 D1 导出和目标 R2 Bucket 写入所需的最小权限。

Catalog 使用 FTS5；Wrangler 不能把包含虚拟表的 D1 直接导出为完整 SQL。因此仓库中的版本化 migrations 是 Schema 备份，R2 SQL 是排除 FTS 虚拟表、影子表、Cloudflare 内部表和 `d1_migrations` 的普通表数据备份。恢复时先按顺序应用 migrations，再导入数据，最后从 `search_documents` 重建 FTS。新增持久化表时，备份工作流会通过 `pragma_table_list` 自动纳入，无需维护静态表清单。

## GitHub Actions configuration

Daily backup requires repository secrets `CLOUDFLARE_D1_BACKUP_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The token is restricted to D1 Read and write access to the private `studyinchina-backups` Bucket.

Quarterly restore uses the protected `cloudflare-restore-drill` Environment. Its `CLOUDFLARE_D1_RESTORE_TOKEN` Environment secret has read-only access to that Bucket and is never shared with daily backup. Enable a required reviewer for this Environment.

Enter secret values only through hidden GitHub or `gh secret set` prompts. The dependency-free preflight prints missing secret names but never values. A checkpoint is valid only after both databases export, local checksum verification, all six uploads, and daily-object readback succeed.

## Failure semantics and triage

- 红色且失败于配置检查：必要的 repository secret 缺失或账号 ID 格式无效；没有创建备份。
- 红色且失败于远程 D1 检查：token 无权访问目标账号/数据库、名称错误或 Cloudflare 不可用；没有开始导出。
- 红色且失败于导出或 artifact 校验：不得使用部分文件，且不会开始 R2 上传。
- 红色且失败于 R2 上传或读回：即使已经写入部分对象，也不能把该日期视为完整恢复点；应修复后整项重跑。若读回文件不是 gzip 原始字节，确认对象位于 `raw-v1/` 且使用 `Content-Encoding: identity`。
- 任务显示 `runner_id=0` 且没有步骤：GitHub-hosted runner 从未分配，属于执行平台取消/排队问题，不是 D1 失败；应直接重跑并继续按 24 小时 RPO 计时。

任何失败或取消都不满足 `RPO <= 24 小时`。工作流会在可执行失败时写入 Job Summary，但在 runner 未分配的情况下没有代码能够运行，因此必须依靠 Actions 告警和人工重跑。

## 本地隔离恢复演练

下载同一批次的三个文件到一个目录，然后运行：

```powershell
npm run cloudflare:restore-drill -- -BackupDirectory C:\secure\studyinchina-backup -ReportPath C:\secure\restore-report.json
```

只验证 Catalog 时可增加 `-Database catalog`；只验证 Pipeline 时使用 `-Database pipeline`。默认验证两者。

`scripts/cloudflare/restore-drill.ps1` 的安全属性：

- 没有远程模式，所有 Wrangler 调用都强制带 `--local`。
- 每次生成随机命名的隔离数据库和独立 `--persist-to` 目录。
- 先按顺序应用当前仓库 migrations；导入时临时移除隔离库中的写入触发器，导入完成后从可信 migration 定义原样恢复。
- 不读取或修改生产 D1，结束后默认删除本地恢复目录。
- 先核对 SHA-256，再以流式方式解压；默认拒绝超过 12 GiB 的解压结果。
- 只删除脚本在指定 `WorkRoot` 下创建且名称以 `drill-` 开头的目录。
- 需要排障时可显式传入 `-KeepWorkDirectory`；该目录包含完整数据库，不得提交或公开上传。

每次演练必须通过：

1. `catalog.sql.gz` / `pipeline.sql.gz` 与 `backup-sha256.txt` 一致。
2. Schema migrations 和数据 SQL 可完整导入全新的本地隔离 D1，所有触发器均已恢复。
3. `PRAGMA foreign_key_check` 返回零行。
4. `PRAGMA integrity_check` 返回且仅返回 `ok`。
5. Catalog 和 Pipeline 的核心表存在。
6. Catalog 有且仅有一个当前 Release，状态为 `active`，并且学校、项目、项目周期和奖学金计数均大于零。

报告只记录校验结果、哈希、行数摘要和隔离数据库名称，不包含 SQL 或原始数据。

## 季度自动演练

`.github/workflows/cloudflare-restore-drill.yml` 在每年 1、4、7、10 月执行，也支持手动选择 `YYYY-MM` 备份。工作流只从私有 R2 下载备份，然后运行本地恢复；恢复步骤不会收到 Cloudflare 凭据，也没有远程 D1 写入命令。 The job is protected by the `cloudflare-restore-drill` Environment, and only the download step receives its read-only token.

演练通过后上传 JSON 报告，保留 90 天。失败时应按以下顺序处理：

1. 检查对象是否来自同一月份以及 checksum 文件是否匹配。
2. 判断是导出不完整、压缩文件损坏、数据库约束失败，还是 Schema/Release 语义失败。
   若对象不在 `backups/monthly/YYYY-MM/raw-v1/`，先将其视为不受支持的旧格式，
   不要通过跳过 gzip 或 SHA 校验来恢复。
3. 在 24 小时内选择前一日或前一月备份重试，并记录可恢复时间点。
4. 如果两个连续备份均不可恢复，立即暂停低优先级采集与 Release 切换，优先修复备份链路。

每次季度演练记录开始和结束时间；超过 4 小时即使最终成功，也按 RTO 失败处理并复盘。

## 真实灾难恢复

本仓库不提供“一键覆盖生产”命令。需要真实恢复时：

1. 冻结新 Release 和 Pipeline 写入，记录当前 Release ID 与故障时间。
2. 选择满足 RPO 的备份，先完成本地隔离演练。
3. 由两人确认目标名称，创建全新的远程隔离 D1；名称必须包含 `restore` 和事件编号，不能使用生产数据库名称或 ID。
4. 将已校验 SQL 导入该隔离 D1，再重复外键、完整性、核心表、当前 Release 和 API 冒烟检查。
5. 通过 Cloudflare Worker 绑定变更把 Preview 指向恢复库；验证后才允许切换 Production。
6. 保留原生产库以便回滚。切换稳定后再恢复采集和发布。

任何直接向 `studyinchina-catalog` 或 `studyinchina-pipeline` 导入备份的请求都必须拒绝；只能通过新建隔离库和绑定切换完成恢复。
