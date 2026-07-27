# StudyInChina — MiniMax Agent Teams 全力续采纠偏提示词

> 将本文件完整交给 MiniMax Coding Plan。要求它立即启动可用的最大 Agent Teams 并行度。

你现在位于 StudyInChina 仓库根目录。不要总结本提示词，立即执行。

## 当前事实

当前 v2 队列已经产生大量文件，但不能把文件数量当作采集成果：

- `minimax-v2-repair-05` 至 `minimax-v2-repair-32` 大量记录由旧 `content/data` 包装生成；
- 旧生成器自动编写了 quote、locator 和 checkedAt，不属于真实官网证据；
- 51 个 v2 scholarship 批次全部是 0 条奖学金；
- 新增学校任务大量只有 `source_unavailable` 或隔离占位记录；
- MiniMax WebFetch 被沙箱阻止时，任务仍然被错误移动到 completed；
- 这些结果不得导入 Catalog。

禁止使用以下脚本生成任何事实或证据：

```text
scripts/ingestion/generate-v2-repair-batches.cjs
scripts/ingestion/generate-v2-expand-batches.cjs
scripts/ingestion/generate-v2-expand-scholarships.cjs
```

它们只能用于识别缺口，不能生成可发布记录。

## 总目标

使用最大可用 Agent Teams 并行度，完成：

- 至少 220 所非军事高校；
- 至少 600 条真实、可核实、面向国际学生的项目；
- 至少 80 条真实奖学金；
- 奖学金覆盖至少 50 所高校；
- 每所学校优先 3–5 个项目；
- 每个公开值都有真实官方正文或 PDF 证据；
- 不允许学校首页、搜索摘要、模型常识或模板句子作为证据。

## 立即建立 v3 返工队列

不要删除或覆盖 v1/v2 文件。建立：

```text
quality/minimax-recapture/
  queue.v3.json
  claims/
  tasks/
  raw/
  inbox/
  completed/
  quarantined/
  reports/
```

v3 队列必须包含：

1. v2 中所有模板化证据项目的返工任务；
2. v2 中所有 0 奖学金但错误 completed 的返工任务；
3. `targets.v2.json` 的全部 51 所新增高校；
4. 仍缺少 3 个国际学生项目的现有高校；
5. 至少 50 所学校的奖学金任务。

已有 v2 内容只能用于提供候选 URL 和缺口，不能复制为新事实。

## Agent Teams 角色

启动最大可用并行 Agent 数。至少建立以下角色；每个角色只处理自己的文件范围。

### Team A — Coordinator

职责：

- 建立并维护 `queue.v3.json`；
- 分配 claim，防止重复学校；
- 检查任务依赖；
- 汇总验证结果；
- 只有 Coordinator 可以 commit 和 push；
- 禁止使用 `git add .` 或 `git add -A`；
- 不得覆盖其他 Agent 的工作。

Coordinator 不采集字段，不编写官方 quote。

### Team B — Official Source Fetchers

至少开启 2–4 个 Fetcher，每个 Worker 使用唯一 ID。

职责：

- 只访问登记过的高校、政府和 CSC 官方 HTTPS 域名；
- 获取真实 HTML、PDF 或官方公开申请目录；
- 保存原始正文、最终 URL、HTTP 状态、抓取时间和内容哈希；
- 原始文件写入任务指定的 `raw/` 目录；
- 同域串行请求，相邻请求至少 5 秒；
- 不绕过 403、验证码、登录、robots.txt 或访问控制；
- 搜索引擎只能发现官方 URL，不保存搜索摘要为证据。

如果 MiniMax 内置 WebFetch 被阻止：

1. 尝试仓库允许的 Node/PowerShell HTTP 客户端；
2. 尝试同校官方中文站、英文站、国际教育学院二级域名和官方 PDF；
3. 记录实际错误；
4. 不得生成 quote；
5. 不得写 completed；
6. 将任务保留为 `blocked_fetch`，让其他 Fetcher 或外部爬虫重试。

没有真实 raw snapshot 的任务不能交给 Extractor。

### Team C — Structured Extractors

至少开启 2–4 个 Extractor。

职责：

- 只读取 Fetcher 保存的 raw snapshot；
- 不直接依赖模型常识；
- 提取国际生项目、申请周期、学制、学费、申请费、截止日期、资格和材料；
- 提取校级、院系、项目、省市和明确适用于学校的 CSC 奖学金；
- quote 必须逐字存在于 raw snapshot；
- locator 必须能定位 HTML 章节、表格行或 PDF 页码；
- 每个字段保存 snapshot 路径或内容哈希；
- 中文、英文、俄文名称齐全；生成译名必须进入 `generatedTranslations`；
- 不允许“翻译待补充”。

Extractor 不得 commit，不得修改 validator。

### Team D — Independent Validators

至少开启 1–2 个 Validator，不能验证自己提取的任务。

必须验证：

- quote 能在 raw snapshot 中逐字找到；
- URL 是官方 HTTPS；
- programUrl 不是学校首页；
- 项目明确面向国际学生；
- 允许个人申请；
- 至少一项学制、学费或未来截止日期为真实 `known`；
- 每批学制覆盖率至少 60%；
- 每批学费覆盖率至少 50%；
- 未来截止日期覆盖率至少 40%，或者存在当前周期官方未公布的原文证据；
- 搜索摘要证据为 0；
- 模板证据为 0；
- 奖学金有真实身份、至少一项资助内容、申请路线和官方页面；
- 0 项目或 0 奖学金任务不能 completed，只能 blocked/quarantined；
- 过期 31 天以上的周期不能进入当前发布集合。

发现以下模板句时直接拒绝：

```text
The official program page identifies this program as open to non-Chinese citizens
Apply online through ... international student application portal
Program length: ... months (full-time)
```

除非这些句子逐字存在于保存的官方 raw snapshot。

### Team E — Catalog Integrator

只处理通过独立 Validator 的任务。

职责：

- 幂等合并学校、项目、周期和奖学金；
- 保留现有 ID 和 slug；
- 不让旧年度覆盖新年度；
- 隔离冲突、低置信度和过期字段；
- 运行完整数据测试；
- 输出 Release 候选；
- 未通过的记录不得进入页面、API、搜索、SEO 或 sitemap。

## 采集顺序

第一优先级：

- 广东外语外贸大学
- 北京语言大学
- 上海外国语大学
- 西安外国语大学
- 深圳大学
- 南方科技大学
- 汕头大学
- 南方医科大学
- 上海对外经贸大学
- 南京审计大学
- 浙江工商大学
- 中国计量大学

第二优先级：

- 各省师范大学；
- 医科、中医药、药科大学；
- 财经、政法、商科大学；
- 邮电、电子、交通、建筑、海洋和农林特色高校。

不要继续集中采集北大、清华、浙大。

## 项目最低合同

每条可发布项目必须有：

```text
institutionId
nameOriginal
name.zh / name.en / name.ru
programType
degreeLevel
discipline
teachingLanguages
internationalEligibility = known:true + evidence
individualApplication = known:true + evidence
durationMonths / tuitionCny / closesOn 至少一项 known + evidence
programUrl（具体项目或国际生目录页）
applyUrl
academicYear
intake
rawSnapshotPath 或 rawSnapshotHash
```

不得用 `To be confirmed` 冒充授课语言。未知就使用明确状态，不要使用占位字符串。

## 奖学金最低合同

每条可发布奖学金必须有：

```text
scholarshipKey
nameOriginal
name.zh / name.en / name.ru
institutionIds
providerType
applicableDegreeLevels
coverage 至少一项 known + evidence
applicationRoute = known + evidence
officialUrl
rawSnapshotPath 或 rawSnapshotHash
```

有当期截止日期时必须采集；尚未公布时必须有官方页面原文证明当前周期未公布。

## 完成和 Git 规则

只有满足全部条件才能写 completed：

- 有真实 raw snapshot；
- quote 与 snapshot 匹配；
- 严格 validator 通过；
- 不是 0 项目/0 奖学金；
- 没有模板证据；
- 没有学校首页证据。

每完成 5 个合格任务：

1. Coordinator 运行测试；
2. 只暂存这 5 个任务及必要代码；
3. commit：

   ```text
   data: add verified international records v3 batch <编号>
   ```

4. `git pull --rebase`；
5. 无冲突才 push；
6. 禁止强推。

持续运行直到 v3 队列为空或额度即将耗尽。停止时必须报告：

- Agent Teams 数量与角色；
- 真实抓取成功学校数；
- blocked_fetch 学校数；
- 新增可发布项目数；
- 新增可发布奖学金数；
- 有学费项目数；
- 有未来截止日期项目数；
- 模板证据拒绝数；
- 最后一次 commit 和 push 哈希。

不要把“创建空文件”“记录来源失败”或“移动到 completed”统计为采集成功。
