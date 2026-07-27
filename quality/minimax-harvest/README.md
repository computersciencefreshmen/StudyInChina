# MiniMax harvest inbox

MiniMax Coding Plan 的官方项目与奖学金采集结果统一进入本目录的 `inbox/`。

持续运行入口为仓库根目录的 `MINIMAX_CONTINUOUS_HARVEST_PROMPT.md`。队列将全部非军校双一流高校与地方国际学生项目优先高校拆成项目、奖学金两个独立通道。

```powershell
npm run minimax:queue
npm run minimax:claim -- --worker minimax-worker-01
```

## 推荐运行方式

为每个 MiniMax 任务分配不重叠的 10–15 所学校。将下面这段话交给 MiniMax：

```text
请完整读取仓库根目录的 MINIMAX_DATA_COLLECTION_PROMPT.md 并严格执行。
本批次 BATCH_ID=minimax-YYYY-MM-DD-region-01。
REGION_OR_SCHOOL_IDS=<填写地区或学校 ID>。
SCHOOL_LIMIT=10，PROGRAM_LIMIT_PER_SCHOOL=5，
SCHOLARSHIP_LIMIT_PER_SCHOOL=5，CHECKED_AT=<今天日期>。
只写提示词指定的两个 inbox 文件，不修改 Catalog，不 commit，不 push。
```

建议并行批次：

| 批次 | 范围 |
| --- | --- |
| north-01 | 北京、天津、河北、山西、内蒙古 |
| north-east-01 | 辽宁、吉林、黑龙江 |
| east-01 | 上海、江苏、浙江、安徽 |
| central-01 | 河南、湖北、湖南、江西 |
| south-01 | 广东、广西、福建、海南 |
| west-01 | 四川、重庆、云南、贵州、西藏 |
| north-west-01 | 陕西、甘肃、宁夏、青海、新疆 |

不同任务不能采集相同学校。优先选择当前 Catalog 中项目不足 3 个，或学制、学费、申请费、未来截止日期缺失最多的高校。

## 可立即交给 MiniMax 的首批任务

在 StudyInChina 仓库根目录启动 MiniMax，然后粘贴：

```text
请完整读取仓库根目录的 MINIMAX_DATA_COLLECTION_PROMPT.md 并严格执行。

BATCH_ID=minimax-2026-07-27-north-gap-01
CHECKED_AT=2026-07-27
SCHOOL_LIMIT=10
PROGRAM_LIMIT_PER_SCHOOL=5
SCHOLARSHIP_LIMIT_PER_SCHOOL=5
REGION_OR_SCHOOL_IDS=[
  "uni-beijing-forestry-university",
  "uni-dalian-maritime-university",
  "uni-liaoning-university",
  "uni-tianjin-university",
  "uni-beijing-jiaotong-university",
  "uni-beijing-institute-of-technology",
  "uni-beijing-sport-university",
  "uni-dalian-university-of-technology",
  "uni-northeastern-university-china",
  "uni-northeast-agricultural-university"
]

只写：
quality/minimax-harvest/inbox/minimax-2026-07-27-north-gap-01.json
quality/minimax-harvest/inbox/minimax-2026-07-27-north-gap-01.md

不要修改 content/data，不要 commit，不要 push。完成后报告两个文件路径。
```

## 合并边界

MiniMax 只负责发现、采集、翻译和提供证据。主项目在合并前还会执行：

1. JSON 结构验证。
2. 官方域名和 URL 安全验证。
3. 项目、学校和奖学金去重。
4. 日期、金额和周期确定性校验。
5. 证据文本匹配和冲突检测。
6. Catalog 隔离构建、测试和发布。

未经这些步骤，`inbox/` 中的记录不得直接在网站展示。
