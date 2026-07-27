# MiniMax 持续采集任务：minimax-all-10-scholarships

先完整读取仓库根目录的 `MINIMAX_DATA_COLLECTION_PROMPT.md`，再执行本任务。

## 锁定参数

- `TASK_ID`: `minimax-all-10-scholarships`
- `TASK_KIND`: `scholarships`
- `CHECKED_AT`: 使用实际运行日期
- `SCHOOL_LIMIT`: `8`
- `PROGRAM_LIMIT_PER_SCHOOL`: `5`
- `SCHOLARSHIP_LIMIT_PER_SCHOOL`: `5`

本任务只采集奖学金。每校目标为 1–5 个可由国际学生申请、且官方页面明确适用于该校的奖学金。
必须分别检查校级、院系/项目、CSC 校级路线、省级和市级官方来源。项目数组保持为空。
整个批次不得以 0 条奖学金完成；若某校确实无法找到，必须记录至少 3 次不同官方入口的发现尝试、失败 URL 和失败原因。

## 学校范围

```json
[
  {
    "targetId": "dfc-2022-073",
    "cohort": "double_first_class",
    "officialNameZh": "南京林业大学",
    "officialNameEn": "Nanjing Forestry University",
    "institutionRef": "uni-nanjing-forestry-university",
    "catalogInstitutionId": "uni-nanjing-forestry-university",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-074",
    "cohort": "double_first_class",
    "officialNameZh": "南京信息工程大学",
    "officialNameEn": "Nanjing University of Information Science and Technology",
    "institutionRef": "uni-nanjing-university-of-information-science-and-technology",
    "catalogInstitutionId": "uni-nanjing-university-of-information-science-and-technology",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-075",
    "cohort": "double_first_class",
    "officialNameZh": "南京农业大学",
    "officialNameEn": "Nanjing Agricultural University",
    "institutionRef": "uni-nanjing-agricultural-university",
    "catalogInstitutionId": "uni-nanjing-agricultural-university",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-076",
    "cohort": "double_first_class",
    "officialNameZh": "南京医科大学",
    "officialNameEn": "Nanjing Medical University",
    "institutionRef": "uni-nanjing-medical-university",
    "catalogInstitutionId": "uni-nanjing-medical-university",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-077",
    "cohort": "double_first_class",
    "officialNameZh": "南京中医药大学",
    "officialNameEn": "Nanjing University of Chinese Medicine",
    "institutionRef": "uni-nanjing-university-of-chinese-medicine",
    "catalogInstitutionId": "uni-nanjing-university-of-chinese-medicine",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-078",
    "cohort": "double_first_class",
    "officialNameZh": "中国药科大学",
    "officialNameEn": "China Pharmaceutical University",
    "institutionRef": "uni-china-pharmaceutical-university",
    "catalogInstitutionId": "uni-china-pharmaceutical-university",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-079",
    "cohort": "double_first_class",
    "officialNameZh": "南京师范大学",
    "officialNameEn": "Nanjing Normal University",
    "institutionRef": "uni-nanjing-normal-university",
    "catalogInstitutionId": "uni-nanjing-normal-university",
    "province": null,
    "city": null,
    "focusTags": []
  },
  {
    "targetId": "dfc-2022-080",
    "cohort": "double_first_class",
    "officialNameZh": "浙江大学",
    "officialNameEn": "Zhejiang University",
    "institutionRef": "uni-zhejiang-university",
    "catalogInstitutionId": "uni-zhejiang-university",
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

- `quality/minimax-harvest/inbox/minimax-all-10-scholarships.json`
- `quality/minimax-harvest/inbox/minimax-all-10-scholarships.md`

JSON 的 `batchId` 必须等于 `minimax-all-10-scholarships`，`scope.schoolIds` 必须按顺序包含：

```json
[
  "uni-nanjing-forestry-university",
  "uni-nanjing-university-of-information-science-and-technology",
  "uni-nanjing-agricultural-university",
  "uni-nanjing-medical-university",
  "uni-nanjing-university-of-chinese-medicine",
  "uni-china-pharmaceutical-university",
  "uni-nanjing-normal-university",
  "uni-zhejiang-university"
]
```

完成后执行：

```powershell
npx tsx scripts/ingestion/validate-minimax-harvest.ts --task minimax-all-10-scholarships
```

验证未通过时继续修复，不得声称完成。不得修改其他文件，不得 commit 或 push。
