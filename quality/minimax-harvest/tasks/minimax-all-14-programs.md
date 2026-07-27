# MiniMax 持续采集任务：minimax-all-14-programs

先完整读取仓库根目录的 `MINIMAX_DATA_COLLECTION_PROMPT.md`，再执行本任务。

## 锁定参数

- `TASK_ID`: `minimax-all-14-programs`
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
    "targetId": "dfc-2022-105",
    "cohort": "double_first_class",
    "officialNameZh": "暨南大学",
    "officialNameEn": "Jinan University",
    "institutionRef": "uni-jinan-university",
    "catalogInstitutionId": "uni-jinan-university",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-106",
    "cohort": "double_first_class",
    "officialNameZh": "华南理工大学",
    "officialNameEn": "South China University of Technology",
    "institutionRef": "uni-south-china-university-of-technology",
    "catalogInstitutionId": "uni-south-china-university-of-technology",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-107",
    "cohort": "double_first_class",
    "officialNameZh": "华南农业大学",
    "officialNameEn": "South China Agricultural University",
    "institutionRef": "uni-south-china-agricultural-university",
    "catalogInstitutionId": "uni-south-china-agricultural-university",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-108",
    "cohort": "double_first_class",
    "officialNameZh": "广州医科大学",
    "officialNameEn": "Guangzhou Medical University",
    "institutionRef": "uni-guangzhou-medical-university",
    "catalogInstitutionId": "uni-guangzhou-medical-university",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-109",
    "cohort": "double_first_class",
    "officialNameZh": "广州中医药大学",
    "officialNameEn": null,
    "institutionRef": "dfc-2022-109",
    "catalogInstitutionId": null,
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-110",
    "cohort": "double_first_class",
    "officialNameZh": "华南师范大学",
    "officialNameEn": "South China Normal University",
    "institutionRef": "uni-south-china-normal-university",
    "catalogInstitutionId": "uni-south-china-normal-university",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-111",
    "cohort": "double_first_class",
    "officialNameZh": "海南大学",
    "officialNameEn": "Hainan University",
    "institutionRef": "uni-hainan-university",
    "catalogInstitutionId": "uni-hainan-university",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-112",
    "cohort": "double_first_class",
    "officialNameZh": "广西大学",
    "officialNameEn": "Guangxi University",
    "institutionRef": "uni-guangxi-university",
    "catalogInstitutionId": "uni-guangxi-university",
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

- `quality/minimax-harvest/inbox/minimax-all-14-programs.json`
- `quality/minimax-harvest/inbox/minimax-all-14-programs.md`

JSON 的 `batchId` 必须等于 `minimax-all-14-programs`，`scope.schoolIds` 必须按顺序包含：

```json
[
  "uni-jinan-university",
  "uni-south-china-university-of-technology",
  "uni-south-china-agricultural-university",
  "uni-guangzhou-medical-university",
  "dfc-2022-109",
  "uni-south-china-normal-university",
  "uni-hainan-university",
  "uni-guangxi-university"
]
```

完成后执行：

```powershell
npx tsx scripts/ingestion/validate-minimax-harvest.ts --task minimax-all-14-programs
```

验证未通过时继续修复，不得声称完成。不得修改其他文件，不得 commit 或 push。
