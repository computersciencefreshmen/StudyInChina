# MiniMax 持续采集任务：minimax-all-17-programs

先完整读取仓库根目录的 `MINIMAX_DATA_COLLECTION_PROMPT.md`，再执行本任务。

## 锁定参数

- `TASK_ID`: `minimax-all-17-programs`
- `TASK_KIND`: `programs`
- `CHECKED_AT`: 使用实际运行日期
- `SCHOOL_LIMIT`: `8`
- `PROGRAM_LIMIT_PER_SCHOOL`: `5`
- `SCHOLARSHIP_LIMIT_PER_SCHOOL`: `5`

本任务只采集国际学生项目与项目事实。每校目标为 3–5 个代表性项目。
必须进行官网实时发现，不能只复制仓库现有记录。重点补全学制、学费、申请费、当前或下一周期开放日和截止日、授课语言、申请入口、资格与材料。
奖学金数组保持为空；奖学金由同批次独立任务负责。

## 学校范围

```json
[
  {
    "targetId": "dfc-2022-129",
    "cohort": "double_first_class",
    "officialNameZh": "西安电子科技大学",
    "officialNameEn": "Xidian University",
    "institutionRef": "uni-xidian-university",
    "catalogInstitutionId": "uni-xidian-university",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-130",
    "cohort": "double_first_class",
    "officialNameZh": "长安大学",
    "officialNameEn": null,
    "institutionRef": "dfc-2022-130",
    "catalogInstitutionId": null,
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-131",
    "cohort": "double_first_class",
    "officialNameZh": "西北农林科技大学",
    "officialNameEn": "Northwest A&F University",
    "institutionRef": "uni-northwest-a-and-f-university",
    "catalogInstitutionId": "uni-northwest-a-and-f-university",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-132",
    "cohort": "double_first_class",
    "officialNameZh": "陕西师范大学",
    "officialNameEn": null,
    "institutionRef": "dfc-2022-132",
    "catalogInstitutionId": null,
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-133",
    "cohort": "double_first_class",
    "officialNameZh": "兰州大学",
    "officialNameEn": "Lanzhou University",
    "institutionRef": "uni-lanzhou-university",
    "catalogInstitutionId": "uni-lanzhou-university",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-134",
    "cohort": "double_first_class",
    "officialNameZh": "青海大学",
    "officialNameEn": null,
    "institutionRef": "dfc-2022-134",
    "catalogInstitutionId": null,
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-135",
    "cohort": "double_first_class",
    "officialNameZh": "宁夏大学",
    "officialNameEn": null,
    "institutionRef": "dfc-2022-135",
    "catalogInstitutionId": null,
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-136",
    "cohort": "double_first_class",
    "officialNameZh": "新疆大学",
    "officialNameEn": null,
    "institutionRef": "dfc-2022-136",
    "catalogInstitutionId": null,
    "province": null,
    "city": null,
    "focusTags": []
  }
]
```

## 强制实时发现

对每所学校至少执行以下步骤：

1. 从学校主站或国际学生招生首页发现当期/下一期招生简章。
2. 检查本科、硕士、博士、语言/非学历目录。
3. 检查费用、申请系统和截止日期页面。
4. 检查学校奖学金栏目以及明确适用于该校的政府奖学金页面。
5. 将新发现的官方入口写入 reconciliation；不得因为仓库已有一条 URL 就停止发现。

不允许用第三方聚合站作为事实来源。403、验证码或失败页面必须失败关闭。

奖学金任务中无法确认奖学金的学校，必须使用：

```json
{
  "institutionId": "分配的 institutionRef",
  "category": "scholarships",
  "reason": "无法确认的具体原因",
  "discoveryAttempts": [
    { "officialUrl": "https://...", "outcome": "检查结果" },
    { "officialUrl": "https://...", "outcome": "检查结果" },
    { "officialUrl": "https://...", "outcome": "检查结果" }
  ],
  "checkedAt": "YYYY-MM-DD"
}
```

## 输出

只能写：

- `quality/minimax-harvest/inbox/minimax-all-17-programs.json`
- `quality/minimax-harvest/inbox/minimax-all-17-programs.md`

JSON 的 `batchId` 必须等于 `minimax-all-17-programs`，`scope.schoolIds` 必须按顺序包含：

```json
[
  "uni-xidian-university",
  "dfc-2022-130",
  "uni-northwest-a-and-f-university",
  "dfc-2022-132",
  "uni-lanzhou-university",
  "dfc-2022-134",
  "dfc-2022-135",
  "dfc-2022-136"
]
```

完成后执行：

```powershell
npx tsx scripts/ingestion/validate-minimax-harvest.ts --task minimax-all-17-programs
```

验证未通过时继续修复，不得声称完成。不得修改其他文件，不得 commit 或 push。
