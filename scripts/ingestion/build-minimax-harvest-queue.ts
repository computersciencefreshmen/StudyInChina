import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

type LocalizedName = {
  zh: string
  en?: string
}

type CatalogUniversity = {
  id: string
  name: LocalizedName
}

type DoubleFirstClassTarget = {
  targetId: string
  ordinal: number
  officialNameZh: string
  catalogInstitutionId?: string
}

type RegionalTarget = {
  targetId: string
  officialNameZh: string
  officialNameEn: string
  province: string
  city: string
  proposedInstitutionId: string
  focusTags: string[]
}

export type MiniMaxTargetSchool = {
  targetId: string
  cohort: 'double_first_class' | 'regional_priority'
  officialNameZh: string
  officialNameEn: string | null
  institutionRef: string
  catalogInstitutionId: string | null
  province: string | null
  city: string | null
  focusTags: string[]
}

export type MiniMaxHarvestTask = {
  id: string
  kind: 'programs' | 'scholarships'
  status: 'pending'
  schools: MiniMaxTargetSchool[]
  promptPath: string
  outputJsonPath: string
  outputMarkdownPath: string
}

export type MiniMaxHarvestQueue = {
  format: 'studyinchina.minimax-harvest-queue'
  formatVersion: 1
  generatedAt: string
  policy: {
    batchSize: number
    separateProgramAndScholarshipPasses: true
    militaryInstitutionsExcluded: true
    officialSourcesOnly: true
  }
  summary: {
    doubleFirstClassTargets: number
    regionalPriorityTargets: number
    uniqueSchools: number
    schoolBatches: number
    tasks: number
  }
  tasks: MiniMaxHarvestTask[]
}

type QueueInput = {
  doubleFirstClassTargets: DoubleFirstClassTarget[]
  regionalTargets: RegionalTarget[]
  catalogUniversities: CatalogUniversity[]
  batchSize: number
  generatedAt: string
}

const MILITARY_NAME = /国防科技|军医大学|军事|武警/u

function chunks<T>(items: T[], size: number): T[][] {
  const output: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size))
  }
  return output
}

function taskPaths(taskId: string): Pick<
MiniMaxHarvestTask,
'promptPath' | 'outputJsonPath' | 'outputMarkdownPath'
> {
  return {
    promptPath: `quality/minimax-harvest/tasks/${taskId}.md`,
    outputJsonPath: `quality/minimax-harvest/inbox/${taskId}.json`,
    outputMarkdownPath: `quality/minimax-harvest/inbox/${taskId}.md`,
  }
}

export function buildMiniMaxHarvestQueue(input: QueueInput): MiniMaxHarvestQueue {
  if (!Number.isInteger(input.batchSize) || input.batchSize < 1 || input.batchSize > 15) {
    throw new Error('batchSize must be an integer from 1 to 15')
  }
  const catalogByZh = new Map(
    input.catalogUniversities.map((university) => [university.name.zh, university]),
  )
  const catalogById = new Map(
    input.catalogUniversities.map((university) => [university.id, university]),
  )
  const schools: MiniMaxTargetSchool[] = []
  const seenNames = new Set<string>()

  for (const target of [...input.doubleFirstClassTargets].sort(
    (left, right) => left.ordinal - right.ordinal,
  )) {
    if (MILITARY_NAME.test(target.officialNameZh)) continue
    const catalog = target.catalogInstitutionId
      ? catalogById.get(target.catalogInstitutionId)
      : catalogByZh.get(target.officialNameZh)
    schools.push({
      targetId: target.targetId,
      cohort: 'double_first_class',
      officialNameZh: target.officialNameZh,
      officialNameEn: catalog?.name.en ?? null,
      institutionRef: catalog?.id ?? target.targetId,
      catalogInstitutionId: catalog?.id ?? null,
      province: null,
      city: null,
      focusTags: [],
    })
    seenNames.add(target.officialNameZh)
  }

  for (const target of input.regionalTargets) {
    if (MILITARY_NAME.test(target.officialNameZh) || seenNames.has(target.officialNameZh)) continue
    const catalog = catalogById.get(target.proposedInstitutionId)
      ?? catalogByZh.get(target.officialNameZh)
    schools.push({
      targetId: target.targetId,
      cohort: 'regional_priority',
      officialNameZh: target.officialNameZh,
      officialNameEn: catalog?.name.en ?? target.officialNameEn,
      institutionRef: catalog?.id ?? target.proposedInstitutionId,
      catalogInstitutionId: catalog?.id ?? null,
      province: target.province,
      city: target.city,
      focusTags: target.focusTags,
    })
    seenNames.add(target.officialNameZh)
  }

  const tasks: MiniMaxHarvestTask[] = []
  const schoolBatches = chunks(schools, input.batchSize)
  schoolBatches.forEach((batch, index) => {
    const batchNumber = String(index + 1).padStart(2, '0')
    for (const kind of ['programs', 'scholarships'] as const) {
      const id = `minimax-all-${batchNumber}-${kind}`
      tasks.push({
        id,
        kind,
        status: 'pending',
        schools: batch,
        ...taskPaths(id),
      })
    }
  })

  const doubleFirstClassTargets = schools.filter(
    (school) => school.cohort === 'double_first_class',
  ).length
  const regionalPriorityTargets = schools.length - doubleFirstClassTargets
  return {
    format: 'studyinchina.minimax-harvest-queue',
    formatVersion: 1,
    generatedAt: input.generatedAt,
    policy: {
      batchSize: input.batchSize,
      separateProgramAndScholarshipPasses: true,
      militaryInstitutionsExcluded: true,
      officialSourcesOnly: true,
    },
    summary: {
      doubleFirstClassTargets,
      regionalPriorityTargets,
      uniqueSchools: schools.length,
      schoolBatches: schoolBatches.length,
      tasks: tasks.length,
    },
    tasks,
  }
}

function renderTaskPrompt(task: MiniMaxHarvestTask): string {
  const focus = task.kind === 'programs'
    ? `本任务只采集国际学生项目与项目事实。每校目标为 3–5 个代表性项目。
必须进行官网实时发现，不能只复制仓库现有记录。重点补全学制、学费、申请费、当前或下一周期开放日和截止日、授课语言、申请入口、资格与材料。
奖学金数组保持为空；奖学金由同批次独立任务负责。`
    : `本任务只采集奖学金。每校目标为 1–5 个可由国际学生申请、且官方页面明确适用于该校的奖学金。
必须分别检查校级、院系/项目、CSC 校级路线、省级和市级官方来源。项目数组保持为空。
整个批次不得以 0 条奖学金完成；若某校确实无法找到，必须记录至少 3 次不同官方入口的发现尝试、失败 URL 和失败原因。`
  return `# MiniMax 持续采集任务：${task.id}

先完整读取仓库根目录的 \`MINIMAX_DATA_COLLECTION_PROMPT.md\`，再执行本任务。

## 锁定参数

- \`TASK_ID\`: \`${task.id}\`
- \`TASK_KIND\`: \`${task.kind}\`
- \`CHECKED_AT\`: 使用实际运行日期
- \`SCHOOL_LIMIT\`: \`${task.schools.length}\`
- \`PROGRAM_LIMIT_PER_SCHOOL\`: \`5\`
- \`SCHOLARSHIP_LIMIT_PER_SCHOOL\`: \`5\`

${focus}

## 学校范围

\`\`\`json
${JSON.stringify(task.schools, null, 2)}
\`\`\`

## 强制实时发现

对每所学校至少执行以下步骤：

1. 从学校主站或国际学生招生首页发现当期/下一期招生简章。
2. 检查本科、硕士、博士、语言/非学历目录。
3. 检查费用、申请系统和截止日期页面。
4. 检查学校奖学金栏目以及明确适用于该校的政府奖学金页面。
5. 将新发现的官方入口写入 reconciliation；不得因为仓库已有一条 URL 就停止发现。

不允许用第三方聚合站作为事实来源。403、验证码或失败页面必须失败关闭。

奖学金任务中无法确认奖学金的学校，必须使用：

\`\`\`json
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
\`\`\`

## 输出

只能写：

- \`${task.outputJsonPath}\`
- \`${task.outputMarkdownPath}\`

JSON 的 \`batchId\` 必须等于 \`${task.id}\`，\`scope.schoolIds\` 必须按顺序包含：

\`\`\`json
${JSON.stringify(task.schools.map((school) => school.institutionRef), null, 2)}
\`\`\`

完成后执行：

\`\`\`powershell
npx tsx scripts/ingestion/validate-minimax-harvest.ts --task ${task.id}
\`\`\`

验证未通过时继续修复，不得声称完成。不得修改其他文件，不得 commit 或 push。
`
}

type Arguments = {
  batchSize: number
  output: string
}

function parseArguments(values: string[]): Arguments {
  let batchSize = 8
  let output = resolve('quality/minimax-harvest/queue.v1.json')
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]
    const value = values[index + 1]
    if (!key || !value) throw new Error('Arguments must use --key value pairs')
    if (key === '--batch-size') batchSize = Number(value)
    else if (key === '--output') output = resolve(value)
    else throw new Error(`Unknown argument: ${key}`)
  }
  return { batchSize, output }
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2))
  const readJson = async <T>(path: string): Promise<T> => (
    JSON.parse(await readFile(resolve(path), 'utf8')) as T
  )
  const doubleFirstClass = await readJson<{ targets: DoubleFirstClassTarget[] }>(
    'content/source-manifests/double-first-class/targets.v1.json',
  )
  const regional = await readJson<{ targets: RegionalTarget[] }>(
    'content/source-manifests/regional-priority/targets.v1.json',
  )
  const catalogUniversities = await readJson<CatalogUniversity[]>(
    'content/data/universities.json',
  )
  const queue = buildMiniMaxHarvestQueue({
    doubleFirstClassTargets: doubleFirstClass.targets,
    regionalTargets: regional.targets,
    catalogUniversities,
    batchSize: args.batchSize,
    generatedAt: new Date().toISOString(),
  })
  await mkdir(dirname(args.output), { recursive: true })
  await writeFile(args.output, `${JSON.stringify(queue, null, 2)}\n`, 'utf8')
  for (const task of queue.tasks) {
    const prompt = resolve(task.promptPath)
    await mkdir(dirname(prompt), { recursive: true })
    await writeFile(prompt, renderTaskPrompt(task), 'utf8')
  }
  console.log(JSON.stringify({
    output: relative(process.cwd(), args.output),
    ...queue.summary,
  }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
