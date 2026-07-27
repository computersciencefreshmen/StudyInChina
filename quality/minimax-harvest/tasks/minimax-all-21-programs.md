# MiniMax 持续采集任务：minimax-all-21-programs

先完整读取仓库根目录的 `MINIMAX_DATA_COLLECTION_PROMPT.md`，再执行本任务。

## 锁定参数

- `TASK_ID`: `minimax-all-21-programs`
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
    "targetId": "regional-017",
    "cohort": "regional_priority",
    "officialNameZh": "昆明医科大学",
    "officialNameEn": "Kunming Medical University",
    "institutionRef": "uni-kunming-medical-university",
    "catalogInstitutionId": null,
    "province": "Yunnan",
    "city": "Kunming",
    "focusTags": [
      "medicine"
    ]
  },
  {
    "targetId": "regional-018",
    "cohort": "regional_priority",
    "officialNameZh": "云南师范大学",
    "officialNameEn": "Yunnan Normal University",
    "institutionRef": "uni-yunnan-normal-university",
    "catalogInstitutionId": null,
    "province": "Yunnan",
    "city": "Kunming",
    "focusTags": [
      "education",
      "chinese-education"
    ]
  },
  {
    "targetId": "regional-019",
    "cohort": "regional_priority",
    "officialNameZh": "西安外国语大学",
    "officialNameEn": "Xi'an International Studies University",
    "institutionRef": "uni-xian-international-studies-university",
    "catalogInstitutionId": null,
    "province": "Shaanxi",
    "city": "Xi'an",
    "focusTags": [
      "languages",
      "international-studies"
    ]
  },
  {
    "targetId": "regional-020",
    "cohort": "regional_priority",
    "officialNameZh": "四川外国语大学",
    "officialNameEn": "Sichuan International Studies University",
    "institutionRef": "uni-sichuan-international-studies-university",
    "catalogInstitutionId": null,
    "province": "Chongqing",
    "city": "Chongqing",
    "focusTags": [
      "languages",
      "international-studies"
    ]
  },
  {
    "targetId": "regional-021",
    "cohort": "regional_priority",
    "officialNameZh": "东北财经大学",
    "officialNameEn": "Dongbei University of Finance and Economics",
    "institutionRef": "uni-dongbei-university-of-finance-and-economics",
    "catalogInstitutionId": null,
    "province": "Liaoning",
    "city": "Dalian",
    "focusTags": [
      "business",
      "economics"
    ]
  },
  {
    "targetId": "regional-022",
    "cohort": "regional_priority",
    "officialNameZh": "上海理工大学",
    "officialNameEn": "University of Shanghai for Science and Technology",
    "institutionRef": "uni-university-of-shanghai-for-science-and-technology",
    "catalogInstitutionId": null,
    "province": "Shanghai",
    "city": "Shanghai",
    "focusTags": [
      "engineering",
      "business"
    ]
  },
  {
    "targetId": "regional-023",
    "cohort": "regional_priority",
    "officialNameZh": "上海师范大学",
    "officialNameEn": "Shanghai Normal University",
    "institutionRef": "uni-shanghai-normal-university",
    "catalogInstitutionId": null,
    "province": "Shanghai",
    "city": "Shanghai",
    "focusTags": [
      "education",
      "chinese-education",
      "humanities"
    ]
  },
  {
    "targetId": "regional-024",
    "cohort": "regional_priority",
    "officialNameZh": "天津外国语大学",
    "officialNameEn": "Tianjin Foreign Studies University",
    "institutionRef": "uni-tianjin-foreign-studies-university",
    "catalogInstitutionId": null,
    "province": "Tianjin",
    "city": "Tianjin",
    "focusTags": [
      "languages",
      "international-studies"
    ]
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

- `quality/minimax-harvest/inbox/minimax-all-21-programs.json`
- `quality/minimax-harvest/inbox/minimax-all-21-programs.md`

JSON 的 `batchId` 必须等于 `minimax-all-21-programs`，`scope.schoolIds` 必须按顺序包含：

```json
[
  "uni-kunming-medical-university",
  "uni-yunnan-normal-university",
  "uni-xian-international-studies-university",
  "uni-sichuan-international-studies-university",
  "uni-dongbei-university-of-finance-and-economics",
  "uni-university-of-shanghai-for-science-and-technology",
  "uni-shanghai-normal-university",
  "uni-tianjin-foreign-studies-university"
]
```

完成后执行：

```powershell
npx tsx scripts/ingestion/validate-minimax-harvest.ts --task minimax-all-21-programs
```

验证未通过时继续修复，不得声称完成。不得修改其他文件，不得 commit 或 push。
