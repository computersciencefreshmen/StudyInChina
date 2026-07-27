# StudyInChina — MiniMax v3 真实数据提取与返工提示词

> 将本文件完整交给 MiniMax Coding Plan。不要总结，立即启动最大可用 Agent Teams 并执行。

你现在位于 StudyInChina 仓库根目录。当前任务不是继续制造更多占位 JSON，而是把已经建立的 v3 采集链路转换成真正可以发布的项目和奖学金数据。

## 一、当前状态

当前已有：

- `quality/minimax-recapture/queue.v3.json`
- 51 所目标学校；
- 102 个任务：
  - 51 个项目任务；
  - 51 个奖学金任务；
- 大约 51 份真实 HTML 快照；
- 大约 27 所学校已经完成至少一次官网访问；
- `scripts/ingestion/validate-minimax-recapture.ts` 严格校验器。

当前问题：

- 严格校验通过任务为 0；
- 大量项目只是 identity placeholder；
- 项目名为空或出现 `undefined`；
- 学制、学费和截止日期仍然为 0；
- 奖学金仍然为 0；
- 部分项目使用学校首页；
- 部分奖学金任务混入了 program；
- 某些页面虽然来自官方域名，但内容与国际学生招生无关。

典型错误：

- 广东外语外贸大学抓到了 `2025 Recruitment Announcement for International Talents`；
- 这是人才/教师招聘，不是国际学生招生；
- 不得把页面中出现的 “foreign students” 当作项目身份；
- 不得生成空项目名或 `undefined:program:*`。

## 二、本轮硬目标

不要继续扩大超过现有 51 所学校。先完成当前队列。

第一验收批目标：

- 至少 10 所学校通过严格校验；
- 至少 30 条可发布国际学生项目；
- 至少 10 条可发布奖学金；
- 至少 20 条项目有学制；
- 至少 15 条项目有学费；
- 至少 12 条项目有未来截止日期；
- 模板证据为 0；
- 学校首页证据为 0；
- 空名称、`undefined` 和 `To be confirmed` 为 0。

达到第一验收批后不要停止，继续完成全部 51 所学校。

## 三、立即停止的错误行为

禁止：

- 继续运行任何从旧 Catalog 自动制造事实的生成器；
- 把学校介绍、教师招聘、人才招聘或新闻页面包装为项目；
- 把页面中偶然出现的 “international students” 当作项目证据；
- 为没有项目身份的页面生成 placeholder program；
- 生成 `undefined:program:*`；
- 项目名为 `null`；
- 使用 `To be confirmed` 充当授课语言；
- 用学校首页作为 `programUrl`；
- 用搜索结果摘要作为 quote；
- 根据模型常识猜测学制、学费、日期或资助金额；
- 0 项目或 0 奖学金任务写入 completed；
- 未通过严格 validator 就 commit；
- 使用 `git add .` 或 `git add -A`。

禁止使用以下脚本生成事实：

```text
scripts/ingestion/generate-v2-repair-batches.cjs
scripts/ingestion/generate-v2-expand-batches.cjs
scripts/ingestion/generate-v2-expand-scholarships.cjs
```

## 四、启动 Agent Teams

启动最大可用 Agent 数量。建议角色：

### 1. Coordinator

职责：

- 读取 `queue.v3.json`；
- 统计哪些任务已有快照、哪些缺少快照；
- 将 0/102 的严格校验状态作为起点；
- 分配学校，禁止两个 Agent 同时改同一任务；
- 维护任务状态：
  - `pending_fetch`
  - `fetched`
  - `extracting`
  - `validation_failed`
  - `validated`
  - `blocked_fetch`
- 只有 Coordinator 可以 commit 和 push。

### 2. Source Discovery Agents

至少 2 个。

职责：

- 检查当前快照是否真的属于国际学生招生；
- 从学校官网寻找：
  - 国际学生招生首页；
  - 当前或下一学年招生简章；
  - 国际学生本科目录；
  - 国际学生硕士和博士目录；
  - 汉语、预科、交换、访学和短期项目；
  - 学费页面；
  - 申请系统；
  - 奖学金目录和奖学金简章；
- 只输出官方 URL 候选和页面分类，不提取事实。

### 3. Official Fetcher Agents

至少 2–4 个。

职责：

- 抓取 Discovery Agent 确认过的官方 HTML/PDF；
- 保存真实正文、最终 URL、HTTP 状态、抓取时间和 SHA-256；
- 同域并发 1；
- 相邻请求至少间隔 5 秒；
- 只访问官方 HTTPS；
- 遵守 robots.txt；
- 不绕过 403、验证码、登录或地区限制。

### 4. Program Extractor Agents

至少 2–4 个。

职责：

- 只读取已经保存的 raw snapshot；
- 从招生简章、项目目录或 PDF 表格提取项目；
- 每校优先 3–5 条代表性项目；
- 不得使用没有项目名的页面；
- quote 必须逐字存在于 raw snapshot。

### 5. Scholarship Extractor Agents

至少 2 个。

职责：

- 独立处理 scholarship 任务；
- scholarship 输出中 `programs` 必须为空；
- 查找学校奖学金、院系奖学金、项目奖学金、省市奖学金；
- CSC 必须有该校官方适用证据；
- 不能因为“通常有 CSC”就生成奖学金。

### 6. Independent Validator Agents

至少 2 个。

职责：

- 不验证自己提取的任务；
- 运行严格校验器；
- 校验失败必须返回 Extractor；
- 不能通过降低 validator 门槛解决失败。

## 五、页面相关性分类

抓取任何页面后，必须先分类，再决定是否提取。

### 可以作为招生来源

页面标题或正文明确包含以下语义：

```text
International Student Admission
Admission Guide for International Students
Application for International Students
Undergraduate Programs for International Students
Master / Doctoral Programs for International Students
Chinese Language Program
Tuition and Fees
Scholarship for International Students
来华留学生招生简章
外国留学生招生
国际学生本科 / 硕士 / 博士
汉语进修项目
国际学生奖学金
```

### 必须排除

```text
Recruitment Announcement for International Talents
Faculty Recruitment
Teacher Recruitment
Jobs / Careers
人才招聘
教师招聘
博士后招聘
新闻报道
会议通知
活动回顾
录取结果名单
毕业生名单
中国学生普通招生
学校介绍
院系介绍
```

页面属于排除类别时：

- 不生成 program；
- 不生成 scholarship；
- 记录 `excluded_irrelevant_page`；
- 继续寻找招生简章。

## 六、官网发现算法

对每所学校执行：

1. 从学校国际教育学院或留学生办公室首页开始；
2. 解析页面中的所有链接；
3. 只保留相同官方主域或登记的官方子域；
4. 对链接标题和 URL 评分；
5. 优先访问包含以下关键词的链接：

```text
admission
apply
international-student
undergraduate
graduate
master
doctoral
program
tuition
fee
scholarship
2026
2027
招生
留学生
项目
专业
学费
奖学金
简章
```

6. 最大抓取深度为 2；
7. 每校最多检查 30 个候选页面；
8. PDF 优先保存并记录页码；
9. 找到招生简章后，再跟踪简章中的项目目录、费用和申请系统链接；
10. 不要穷举不存在的二级域名制造大量 `ENOTFOUND`。

搜索引擎只能用于发现官方 URL。搜索摘要不得作为事实。

## 七、项目提取最低要求

每条可发布项目必须具备：

```text
institutionId
institutionName
programKey
nameOriginal
name.zh
name.en
name.ru
programType
degreeLevel
discipline
teachingLanguages
internationalEligibility = known:true
individualApplication = known:true
programUrl
applyUrl
rawSnapshotPath
rawSnapshotHash
```

并且至少一项为 `known`：

```text
durationMonths
tuitionCny
未来 closesOn
```

每个 `known` 字段必须包含：

```text
value
rawValue（适用时）
officialUrl
sourceTitle
checkedAt
quote
locator
rawSnapshotPath 或 rawSnapshotHash
```

项目身份必须来自：

- 具体项目页；
- 国际学生项目目录；
- 国际学生招生简章中的表格行；
- PDF 项目目录及页码。

不得从以下内容生成项目：

- 学校简介；
- 院系简介；
- 教师招聘；
- 页面页脚；
- 新闻稿；
- 仅出现“外国学生”字样的段落。

## 八、奖学金提取最低要求

每条奖学金必须具备：

```text
scholarshipKey
nameOriginal
name.zh
name.en
name.ru
institutionIds
providerType
applicableDegreeLevels
officialUrl
applicationRoute = known
coverage 至少一项 known
rawSnapshotPath 或 rawSnapshotHash
```

可接受的 coverage：

```text
tuition
accommodation
insurance
stipendCnyPerMonth
```

必须确认奖学金适用于该学校或该项目。

只有奖学金名称，没有资助内容或申请路线时：

- 不能发布；
- 保留为 `needs_follow_up`；
- 不得 completed。

## 九、日期规则

本轮基准日期：

```text
CHECKED_AT = 2026-07-27
```

优先采集：

- 2026–2027；
- 2027 春季；
- 2027 秋季；
- 官网明确公布的下一招生周期。

规则：

- 截止日期晚于检查日：`open` 或 `future`；
- 已截止不超过 30 天：`recently_closed`；
- 已截止 31 天以上：`expired`，不能进入当前发布数据；
- 当前周期尚未公布必须有官方原文证据；
- 旧年度不能覆盖新年度；
- 春季和秋季必须拆开。

## 十、处理当前失败输出

当前 `quality/minimax-recapture/inbox/` 中没有一个任务通过严格校验。

处理方法：

1. 不删除 raw snapshot；
2. 将错误 JSON 保存到：

   ```text
   quality/minimax-recapture/quarantined/<TASK_ID>-attempt-1.json
   ```

3. Markdown 中记录失败原因；
4. 使用正确招生页面重新抓取；
5. 用真实数据重写任务的正式 output JSON；
6. 不得复制旧 placeholder；
7. 重新运行严格校验；
8. 通过后才能 completed。

特别修复：

- 所有 `undefined:program:*`；
- 所有项目名为空；
- 所有 `To be confirmed`；
- 所有学校首页 programUrl；
- scholarship task 中出现 programs；
- 空 scholarships；
- 没有申请路线的项目；
- 没有国际学生资格证据的项目。

## 十一、严格校验命令

每个任务执行：

```powershell
npx tsx scripts/ingestion/validate-minimax-recapture.ts --task <TASK_ID>
```

禁止：

- 修改 validator 降低门槛；
- 手工创建 completed marker；
- 把校验异常 catch 后继续提交；
- 用 documented failure 冒充采集成功。

## 十二、Git 与快照规则

raw HTML/PDF 默认保持私有，不批量提交到 GitHub。

允许提交：

- 通过校验的结构化 JSON；
- Markdown 采集报告；
- snapshot hash；
- 官方 URL；
- validator 生成的 completed marker；
- 队列状态和汇总报告。

禁止提交：

- 没通过校验的正式 output；
- 大量 raw HTML/PDF；
- 用户隐私数据；
- 密钥；
- 其他 Agent 的未完成文件。

每完成 5 个通过任务：

1. Coordinator 执行严格校验；
2. 运行相关测试；
3. 只暂存通过任务；
4. commit：

   ```text
   data: add source-backed recapture batch <编号>
   ```

5. pull --rebase；
6. 无冲突才 push；
7. 禁止强推。

## 十三、停止条件

不要因为生成了文件就停止。

只有以下情况可以停止：

1. 51 所学校全部完成；
2. 额度即将耗尽；
3. 必须由用户解决登录、验证码或权限；
4. 官方网站持续不可访问且所有合法入口已经尝试。

每次汇报必须包含：

- Agent Teams 数量与角色；
- 已检查学校数；
- 有效招生页面数；
- 有效奖学金页面数；
- 保存的 raw snapshot 数；
- 严格校验通过任务数；
- 新增可发布项目数；
- 新增可发布奖学金数；
- 有学制、学费、未来截止日期的项目数；
- blocked_fetch 数；
- irrelevant page 排除数；
- 最后一次 commit 和 push 哈希。

如果严格校验通过数仍为 0，禁止回复“任务完成”，必须继续修复页面发现和提取逻辑。
