# 第一批真实用户推广与访谈手册

状态：供项目所有者审核和自行分发的草稿。编写日期：2026-10-17。

时点说明：本手册保留下述早期研究的验证范围。随后本轮已完成正式网站接口、255所候选学校页面、六语种与手机端检查，并发布755个当前项目（覆盖7校）；实际发布与剩余覆盖缺口见[运维记录](../operations/national-program-maintenance-2026-10-17.md)。这不代表已经完成社群投放或用户访谈。

本文没有代表所有者发布帖子、联系社群管理员、发送私信或招募受访者，也不构成任何平台的发帖许可。本次根据仓库 README 和页面代码确认产品描述；未成功核实线上页面正文、生产部署、当前招生覆盖或分析后台。下列公开网址来自仓库，分发前由所有者实际打开检查。

## 1. 先明确这轮推广要验证什么

项目的长期价值是帮助国际学生把分散的官方招生信息整理成可以比较、可以回溯来源的申请选择。本轮阶段是从“产品已实现”进入“真实学生能完成决策任务”的验证。我们先验证目录能否减少查找和核对成本，再讨论扩大流量。

暂定第一批用户：准备在未来 6–12 个月申请中国高校、主要寻找英语授课研究生项目的国际学生。先以硕士申请者形成一个较一致的小群体；博士申请的导师匹配流程差异较大，单独记录，不混入硕士任务成功率。这是待验证的切入假设，并非已有用户需求结论。

选择这个范围的原因：学生的语言、学位和申请阶段相近，更容易比较他们需要哪些证据。代价是样本不能代表全部来华留学生。如果当前官方资料无法支持这个群体的关键决策，先缩小院校/专业范围，或经实际访谈调整群体；不要用旧学费、旧截止日期补足营销故事。

未来商业方向是“免费目录作为入口，探索可选的付费 AI 简历/背景分析与项目匹配辅助”。目前只把它作为研究假设。本文不宣称付费功能已上线、不承诺何时上线、不收集简历、不收款、不保证匹配正确、录取结果或奖学金。正式产品的收费、数据处理和验证方案需要另行设计。

## 2. 分发前的数据与体验门槛

所有者先用手机和桌面完成以下检查，并记录实际检查日期；没有完成的项保持“待核实”。

- 打开首页、项目目录、项目详情、比较页和官方来源链接，确认生产环境实际可用。
- 为这批用户挑出 3–5 个可用于演示的项目。这个数量是试验准备目标，不是已核实覆盖。逐个确认学位和授课语言的官方依据，分清专业目录身份与当前招生周期。
- 对演示中的学费、语言要求、申请入口、奖学金关系和截止日期逐项核对官方来源及对应学年；缺失、冲突、过期的信息按页面状态说明，不能口头补成事实。
- 当前本地按日期发布的奖学金数量为 0，生产覆盖也未验证。只有确认生产环境存在可用、未过期且范围清楚的奖学金记录后，才把“奖学金发现”写进产品推广能力；此前只分享通用核对方法。
- 不把“目录里存在项目”表达成“现在可以申请”。若没有合适的当前周期资料，演示任务改成“发现并核实候选项目”，不招揽学生通过本站提交申请。
- 试做“找到两个候选项目 → 加入比较 → 打开官方来源 → 判断还缺什么”的完整路径。若没有两个适合的候选项，先修复内容或调整访谈任务范围。
- 检查分享网址的标题、描述、预览图和实际打开结果；UTM 链接也逐一打开。确认没有暗示官方隶属、奖学金保证或已上线的付费服务。

代码层面已确认 `src/lib/program-catalog.ts` 接受 `degree=master`、`degree=doctorate` 和大小写敏感的 `language=English`，但这不证明线上相应结果充足或当前招生有效。第一轮推广统一使用不带业务筛选条件的 `/en/programs`，让受访者自己寻找筛选入口；这样也能观察可发现性。

## 3. 渠道优先顺序与边界

| 优先级 | 渠道 | 本轮做法 | 边界 |
| --- | --- | --- | --- |
| 1 | 所有者自己的 LinkedIn、个人主页 | 一篇诚实的产品介绍，加一个明确的小任务；随后发布下方三篇教育内容。 | 可以自行编辑草稿；不要编造用户评价、合作关系、用户数量或申请结果。 |
| 1 | 已加入且相关的国际学生/申请者社群 | 由所有者确认管理员允许招募或资源分享后，在指定位置发一次；明确自己是开发者。优先找到真实申请者，不追求群数量。 | 本手册没有授予发帖或发消息权限；不抓取成员、不群发私信、不用多个账号假装学生推荐。规则和许可范围以各群实际要求为准。 |
| 2，条件渠道 | Reddit 的 r/ChineseLanguage | 仅当研究切到中文语言进修项目时考虑，内容必须直接帮助学习中文的人；不把英语授课硕士主帖投到这里。 | [当前规则](https://www.reddit.com/r/ChineseLanguage/)和[自荐政策](https://www.reddit.com/r/ChineseLanguage/wiki/self-promotion/)要求每次事前获得版主许可，通常需要约十次有意义的本社区参与、至少九成不涉及推广，资源须免费或有免费试用。评论中提及自己的网站也算自荐；不能把约十次参与当作刷帖任务。 |
| 可选，非核心获客 | Hacker News / Show HN | 后续用于讨论比较工具、来源证据与数据新鲜度设计，结果单独归类为工程反馈。 | [Show HN](https://news.ycombinator.com/showhn.html)要求作者亲自参与制作、产品可体验、作者参与讨论；普通清单或落地页并不适合。[HN 总规则](https://news.ycombinator.com/newsguidelines.html)禁止生成式文本帖子及 AI 编辑评论，所有者须自行原创，不能粘贴本文草稿，也不能自动发布或拉票。 |

不优先考虑宽泛的留学社区。例如 [r/studyAbroad 当前规则](https://www.reddit.com/r/studyAbroad/)禁止直接营销和 AI 生成内容，不应把它当作免费广告位。[r/languagelearning 的推广政策](https://www.reddit.com/r/languagelearning/wiki/rules_for_promotion/)也对位置、频次、许可及 AI 文案设有限制，不适合把本轮英语授课研究生目录介绍直接搬过去。

[Reddit 官方反垃圾政策](https://support.reddithelp.com/hc/en-us/articles/360043504051-Spam)禁止重复或未经请求的大规模互动，社区可另行限制推广。因此不同社区需要分别核实，不能依据“免费项目”或泛用的 10% 说法推定许可。以上规则于编写时查阅；实际分发前再读一次。

## 4. 自有渠道英文草稿

用途：所有者自己的 LinkedIn 或个人主页。发布前应核对生产体验，并用自己的经历改写；这不是 Reddit/HN 发帖模板。

> I’m building Study in China Atlas, a free, independent directory for international students exploring universities and programs in China.
>
> It brings program filters, comparison of up to four options, and links to official university sources into one place. It also shows when information is missing, conflicting or no longer current.
>
> I’m looking for feedback from students preparing to apply in the next 6–12 months, especially those exploring English-taught master’s programs. The catalogue is still developing: a listing does not mean applications are open, and some records are starting points for further research rather than complete application guides.
>
> Could you try finding two possible programs, compare them, and tell me what you still need before deciding where to apply?
>
> [Browse programs](https://studyinchina.vercel.app/en/programs?utm_source=linkedin&utm_medium=organic_social&utm_campaign=first_cohort_14d&utm_content=intro)
>
> I made the site and would also welcome a voluntary 25-minute feedback conversation. No CV, passport or application documents are needed.
>
> This is an independent directory. Please confirm deadlines, fees and eligibility with the official university or scholarship provider.

若使用个人主页，把链接换成下一节的 `personal_site` 版本。若所有者尚不能安排访谈，删去访谈邀请；不要发出无法履行的邀请。

## 5. 三篇教育内容提纲

每篇首先让读者得到一项可直接使用的方法，末尾再邀请试用一次。英文标题供所有者选择；正文根据真实核实材料编写，不补写个案事实。

1. **Before shortlisting a program, check these five things.** 教学生核对学位、授课语言、对应招生周期、官方申请入口和资格要求；配一个所有者实际核实的示例，展示如何从目录回到官方通知。任务：找到两个候选项目，并写下一个还缺的证据。使用 `checklist` 链接。
2. **A missing deadline is a question to verify.** 解释“未公布”“来源无法读取”“过期”“信息冲突”的差异；展示为什么不能把往年日期直接改成年份。演示真实页面时显示检查日期和官方来源。任务：让读者说明某个截止日期能否用于本次申请，以及原因。使用 `uncertainty` 链接。
3. **A scholarship listing does not establish your eligibility.** 这是通用核对方法，不暗示本站已有当前可用奖学金目录。给读者一个核对顺序：资助主体 → 适用学位/项目 → 国籍或其他资格 → 覆盖范围 → 申请路径 → 当前周期与截止日期。区分学校层面奖学金与项目明确关联；不使用“人人可申”“全奖稳拿”等话术。任务：标记一项必须去官方页面核实的条件。使用 `scholarship_scope` 链接。

不要为了完成发帖计划而展示未经核实的金额、录取率或申请期。如果没有可展示个案，发布方法图解或空白核对表即可。

## 6. 可直接检查的 UTM 链接

UTM 是附在网址后的渠道标签，用于保持分发命名一致；它本身不是统计系统，也不会自动记录一次浏览或完成一次比较。仓库引入了 Vercel Analytics，不足以证明生产后台已经按 UTM 归因、具备转化事件或能关联单个受访者。本轮以手工记录和受访者自述来源为准。

固定 campaign 为 `first_cohort_14d`。下面的 source、medium、content 都是新设计的标签，不是既有统计结果。所有链接均指向仓库已知的 `/en/programs`；没有姓名、邮箱、学校编号、简历信息或个人受访者 ID。

| 使用位置 | 链接 |
| --- | --- |
| LinkedIn 介绍 | [linkedin / organic_social / intro](https://studyinchina.vercel.app/en/programs?utm_source=linkedin&utm_medium=organic_social&utm_campaign=first_cohort_14d&utm_content=intro) |
| LinkedIn 核对清单 | [linkedin / organic_social / checklist](https://studyinchina.vercel.app/en/programs?utm_source=linkedin&utm_medium=organic_social&utm_campaign=first_cohort_14d&utm_content=checklist) |
| LinkedIn 信息状态解释 | [linkedin / organic_social / uncertainty](https://studyinchina.vercel.app/en/programs?utm_source=linkedin&utm_medium=organic_social&utm_campaign=first_cohort_14d&utm_content=uncertainty) |
| LinkedIn 奖学金条件核对 | [linkedin / organic_social / scholarship_scope](https://studyinchina.vercel.app/en/programs?utm_source=linkedin&utm_medium=organic_social&utm_campaign=first_cohort_14d&utm_content=scholarship_scope) |
| 个人主页 | [personal_site / referral / intro](https://studyinchina.vercel.app/en/programs?utm_source=personal_site&utm_medium=referral&utm_campaign=first_cohort_14d&utm_content=intro) |
| 已获许可的第一个学生社群 | [student_community_a / community / approved_intro](https://studyinchina.vercel.app/en/programs?utm_source=student_community_a&utm_medium=community&utm_campaign=first_cohort_14d&utm_content=approved_intro) |
| 已获许可的第二个学生社群 | [student_community_b / community / approved_intro](https://studyinchina.vercel.app/en/programs?utm_source=student_community_b&utm_medium=community&utm_campaign=first_cohort_14d&utm_content=approved_intro) |

所有者在私有工作记录中写明 community_a/b 对应哪个已许可社群即可，不把群成员或私人群链接写进公开材料。同一内容在同一渠道复用同一标签。不要为了“更精准”生成带个人标识的追踪链接。

## 7. 20 场任务访谈怎么招募、怎么完成

**20 场完成访谈是本轮容量假设，不是市场基准或结果承诺。** 计划约 25 分钟访谈加 10 分钟整理，20 场约需 12 小时，另留招募排期时间。没有足够相关自愿者时延长周期或报告实际样本，不用不相关同学凑数。

招募路径：所有者在自有渠道和允许招募的现有社群发一次明确邀请 → 愿意的人主动回应 → 所有者私下确认筛选条件和时间 → 获得口头同意后访谈 → 匿名整理。可以准备约 4 位候补，候补数量同样是排期假设。不要把“目标 20 人”变成给 20 个陌生人发送推销私信。

入组筛选只需四件事：是否为国际申请者、是否考虑未来 6–12 个月申请、目标学位/授课语言、当前阶段。允许只回答大致方向；无需姓名之外的身份核验，更不需要护照、成绩单或简历。

| 目标分组 | 暂定人数 | 需要观察的真实任务 |
| --- | ---: | --- |
| 探索阶段，还没有明确候选项目 | 8 | 能否找到两个值得进一步核实的候选项，能否说明为什么选择它们 |
| 已有候选项，正在比较 | 8 | 能否比较两项重要差异，并找到支持判断的官方证据 |
| 接近核实申请步骤 | 4 | 能否分清当前周期与历史资料，识别还需要向官方确认的内容 |

以上配额是为了看到不同任务，不用于代表市场比例；某组不足时保留空缺，并把访谈结果按实际阶段报告。

开场可说：“我们在测试网站，不是在考你。你可以随时停止或跳过问题。今天不需要你的申请文件；我会记匿名任务笔记，未经同意不会录音、录像或引用你的原话。”为联系和排期自愿提供的信息与匿名笔记分开保管，不提交到 Git 仓库。没有另行取得同意就不要录制；本轮结束后 30 天内清理排期联系信息，若需要保留其他资料，先与参与者约定用途和期限。

访谈按以下顺序进行，先观察再解释：

1. **过去的行为，约 5 分钟。** “上次你查一个中国高校项目时，具体从哪里开始？最后卡在哪一步？”“你当时用了哪些页面、表格或工具？”“为了核实哪项信息花过最多时间？”不要问“你是不是觉得现在查资料很麻烦”。
2. **独立任务，约 10 分钟。** 给参与者目录链接，请其根据自己的目标找到两个候选项目、尝试比较、打开至少一项官方依据，并说出还缺什么才能做下一步。让其边操作边说想法；不提示按钮位置。确实无法继续时再给提示，并单独记录“经帮助完成”。没有适合的项目也属于有效发现。
3. **理解核对，约 5 分钟。** “这条记录说明现在能申请吗？你依据什么？”“页面没有显示学费/截止日期时，你认为是什么意思？”“哪里让你以为网站确认了某件事，但实际没有？”“下一步你会打开哪个官方链接？”
4. **未来服务探索，约 5 分钟。** 先问“你现在怎样把自己的背景和项目条件逐项对照？上一次为这类帮助付过费吗，实际买的是什么？”再说明“我们尚未推出可选的 AI 简历/背景辅助”，问“如果以后试用，你必须看到哪些证据才会信任它？哪些资料你不愿提供？什么错误会让你停止使用？”最后可问是否愿意在未来原型可体验时自行选择联系；不同意不影响本次访谈。

不要把“听起来不错”“我可能会付费”当成付费需求已验证。先记录具体问题、现有替代做法和过去投入，再看后续是否有人自愿完成真实原型试用。不能从小样本访谈推算录取收益或商业收入。

## 8. 14 天相对日程

第 1 天从所有者开始执行这轮验证时算起；下表不创建日历事件、自动化或发帖任务。若数据门槛没有通过，后续分发顺延。

| 时间 | 所有者的动作 | 当天留下的证据 |
| --- | --- | --- |
| 第 1 天 | 完成生产体验检查和演示项目官方资料核对，确认第一批人群适配 | 检查日期、发现的问题、可演示任务；不合适则先调整范围 |
| 第 2 天 | 核对自有主页信息与链接；检查已有社群规则和许可；准备匿名记录模板 | 实际可用的链接、明确允许的渠道；没有许可的渠道不排发布 |
| 第 3 天 | 所有者自行改写并发布自有渠道介绍；在已许可位置分享一次，开放自愿报名 | 发布链接、时间、使用的 source/content、主动报名人数 |
| 第 4 天 | 筛选和排期，完成 2 场访谈 | 2 份匿名任务记录和一个最明显的阻碍 |
| 第 5 天 | 发布核对清单内容；完成 2 场访谈 | 内容链接、用户是否找到官方依据 |
| 第 6 天 | 完成 2 场访谈；只处理阻断任务的明显问题 | 问题截图或匿名描述、修复前后版本；不混淆两版结果 |
| 第 7 天 | 完成 2 场访谈；做第一周复盘 | 实际 8 场目标的完成情况、缺少的阶段样本；无新发现就减少发布频率 |
| 第 8 天 | 发布信息状态解释；只向已主动同意排期者确认时间 | 自愿招募进度、不同错误理解的例子 |
| 第 9 天 | 完成 3 场访谈 | 独立完成与帮助完成分别计数 |
| 第 10 天 | 完成 3 场访谈 | 现有比较流程、学生真正缺的证据 |
| 第 11 天 | 发布奖学金条件核对；完成 2 场访谈 | 资料时效与适用范围理解情况 |
| 第 12 天 | 完成 2 场访谈 | 是否错误理解“目录收录”等于“开放申请” |
| 第 13 天 | 完成 2 场访谈，补足缺失阶段；目标累计 20 场 | 实际完成样本、失约数、未满足配额；不足就如实写明 |
| 第 14 天 | 汇总任务表现和需求证据，选择下一轮最小改进 | 一页结论：继续扩同类用户、先修体验/数据，或调整群体；保留未知项 |

不要同时大改整个产品和扩大渠道：这会让访谈中出现的变化难以归因。必要修复可以做，但记录受访者使用的日期和版本，不声称得到严格对照实验的结论。

## 9. 零预算计量与复盘标准

预算为 0 元：使用所有者已有账号、网站、手工笔记和本地表格，不购买广告、联系人名单、付费统计工具或参与者奖励。参与自愿且不提供报酬，招募时说清楚；若所有者后续改变预算，应单独更新计划。

手工记录模板（可放在所有者现有的私有表格中，不把个人信息写进公开仓库）：

| 匿名编号 | 阶段 | 自述来源 source/content | 使用日期/版本 | 任务是否启动 | 两项候选 | 完成比较 | 找到官方依据 | 正确区分当前/历史/未知 | 是否需提示 | 主要阻碍 | 现有替代方法 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P01 | 探索/比较/核实 | linkedin/intro 或不确定 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |

来源询问可以是：“你从哪里第一次看到这个网站？如果记不清可以选不确定。”UTM 标签和自述来源不一致时保留差异，不擅自修成一致。不把有标签的发布次数当点击数，不把访谈报名数当独立访客数。

本轮核心指标及分母：

- **招募进度**：自愿表达兴趣人数 → 满足筛选条件人数 → 已排期人数 → 完成访谈人数。只记录能实际观察的数量，不虚构社群曝光或到站总量。
- **任务完成**：独立完成“两项候选 + 比较 + 官方依据”的人数 / 实际启动该任务的人数；提示后完成单列，目录中没有合适项目也要保留在分母并注明原因。
- **证据理解**：正确分清当前、历史或未知状态的人数 / 实际做了该理解核对的人数。记录错误类型，尤其是把旧周期理解成当前招生的情况。
- **核心问题重复度**：每个障碍涉及多少名参与者、在哪个阶段出现；原话匿名且先获引用同意。次数不是市场占比。
- **后续使用信号**：参与者主动再次使用、回报具体问题或要求继续体验的人数。只有能观察或经自述确认的才记录；未来原型联系许可与付费承诺分别统计。

供决策讨论的试验阈值：在 20 场目标访谈中，希望至少 12 人能独立完成核心任务；若至少 5 人独立遇到同一个高影响阻碍，优先解决它。这两个数字只是本轮假设，不是行业水平。若样本不足，报告真实的 `x/n`，不要套用绝对人数阈值，也不要为了达标改变任务定义。

任何一例把过期信息当成当前申请依据的严重误解，都应先检查信息表达和来源状态。没有可信数据或任务完成证据时，扩大流量只会放大信任问题。只有同类用户能完成任务、理解边界且反复提出某种背景匹配需求，才进入下一轮付费辅助原型验证；是否愿意付费仍需独立验证。

## 10. 搜索发现的配套工作

搜索是长期发现渠道，本轮访谈不能用搜索排名代替。仓库已生成 sitemap 和 robots 路由，并对部分薄内容设置索引门槛；不要为了增加可索引页数移除这些门槛。

所有者可在完成 Search Console 所有权验证后，检查并提交 [sitemap.xml](https://studyinchina.vercel.app/sitemap.xml)，再对首页、项目目录和一篇资料完整的指南使用 [URL Inspection](https://support.google.com/webmasters/answer/9012289/)。这些是待执行动作，本文不声称已提交或已收录。

[Google 官方 sitemap 指南](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)说明 sitemap 提交只是抓取线索，不保证抓取或收录；`lastmod` 应反映真实的重要更新，Google 忽略 `priority` 和 `changefreq`。不要购买“保证收录”，不要把改日期作为内容更新，也不要在未进入 Search Console 查看之前声称已获得自然搜索流量。
