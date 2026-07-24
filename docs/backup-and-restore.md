# Cloudflare D1 备份与恢复演练

## 目标与边界

生产数据库的恢复目标为 `RPO <= 24 小时`、`RTO <= 4 小时`。每日备份保留 35 天，每月副本保留 370 天（覆盖 12 个完整月及闰年差异）。备份和演练都不得把申请人个人资料写入仓库或 CI Artifact。

`.github/workflows/cloudflare-backup.yml` 每日执行以下操作：

1. 使用 Cloudflare 只读/备份权限枚举普通数据表，并导出 `studyinchina-catalog` 和 `studyinchina-pipeline` 的数据。
2. 生成 `catalog.sql.gz`、`pipeline.sql.gz` 和 `backup-sha256.txt`。
3. 上传到私有 R2 的 `backups/daily/YYYY-MM-DD/` 和 `backups/monthly/YYYY-MM/`。

R2 生命周期由 `npm run cloudflare:retention` 配置。备份 Token 应只具备 D1 导出和目标 R2 Bucket 写入所需的最小权限。

Catalog 使用 FTS5；Wrangler 不能把包含虚拟表的 D1 直接导出为完整 SQL。因此仓库中的版本化 migrations 是 Schema 备份，R2 SQL 是排除 FTS 虚拟表、影子表、Cloudflare 内部表和 `d1_migrations` 的普通表数据备份。恢复时先按顺序应用 migrations，再导入数据，最后从 `search_documents` 重建 FTS。新增持久化表时，备份工作流会通过 `pragma_table_list` 自动纳入，无需维护静态表清单。

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

`.github/workflows/cloudflare-restore-drill.yml` 在每年 1、4、7、10 月执行，也支持手动选择 `YYYY-MM` 备份。工作流只从私有 R2 下载备份，然后运行本地恢复；恢复步骤不会收到 Cloudflare 凭据，也没有远程 D1 写入命令。

演练通过后上传 JSON 报告，保留 90 天。失败时应按以下顺序处理：

1. 检查对象是否来自同一月份以及 checksum 文件是否匹配。
2. 判断是导出不完整、压缩文件损坏、数据库约束失败，还是 Schema/Release 语义失败。
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
