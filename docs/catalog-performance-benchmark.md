# Catalog 合成性能验收

`scripts/catalog/benchmark-catalog.ts` 使用真实 Catalog migrations、当前 Release 指针、`current_*` 视图和 FTS5 索引，生成可重复的本地合成数据并测量查询 p95。

默认完整规模与扩容验收目标一致：

- 1,000 所学校
- 100,000 个项目
- 300,000 个项目周期
- 200 次计时样本，另有 20 次预热

运行完整验收：

```bash
npm run benchmark:catalog
```

快速验证 harness：

```bash
npm run benchmark:catalog:smoke
```

报告默认写入被 Git 忽略的 `.benchmark/`，合成 SQLite 在结束后删除。只有显式传入 `--keep-db` 才保留数据库；不要提交该目录。

可通过 `--institutions`、`--programs`、`--cycles`、`--iterations`、`--warmup`、`--seed`、`--output` 和 `--work-dir` 调整运行。项目数不得少于学校数，周期数不得少于项目数。

## 判定标准

报告对以下五项分别计算 nearest-rank p50、p95、p99 和最大值：

- `institutions.list`
- `institutions.detail`
- `programs.list`
- `programs.detail`
- `search.fts`

学校与项目列表/详情要求 `p95 < 250ms`；FTS 查询要求 `p95 < 500ms`。任一指标未达到严格小于阈值，命令退出码为非零。报告同时校验 `current_institutions`、`current_programs`、`current_program_cycles` 和搜索文档数量与目标规模完全一致。

该工具测量本地 SQLite/D1 查询执行时间，不包含 Worker 网络、Cloudflare 边缘缓存或生产并发延迟。因此它用于验证 Schema、视图、索引和查询计划不会随数据规模明显退化，不能替代部署后的 API 压测；报告中的 `limitations` 会保留这一限制。
