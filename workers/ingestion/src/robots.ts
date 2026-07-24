export type RobotsRule = {
  directive: 'allow' | 'disallow'
  path: string
}

type RobotsGroup = {
  agents: string[]
  rules: RobotsRule[]
}

function cleanLine(rawLine: string): string {
  return rawLine.replace(/#.*$/, '').trim()
}

export function parseRobotsTxt(contents: string): RobotsGroup[] {
  const groups: RobotsGroup[] = []
  let current: RobotsGroup | null = null
  let sawRule = false

  for (const rawLine of contents.replace(/\r\n?/g, '\n').split('\n')) {
    const line = cleanLine(rawLine)
    if (!line) {
      if (current?.rules.length) {
        current = null
        sawRule = false
      }
      continue
    }
    const separator = line.indexOf(':')
    if (separator < 1) continue
    const directive = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()

    if (directive === 'user-agent') {
      if (!current || sawRule) {
        current = { agents: [], rules: [] }
        groups.push(current)
        sawRule = false
      }
      if (value) current.agents.push(value.toLowerCase())
      continue
    }
    if ((directive === 'allow' || directive === 'disallow') && current) {
      current.rules.push({ directive, path: value })
      sawRule = true
    }
  }
  return groups.filter((group) => group.agents.length > 0)
}

function userAgentToken(userAgent: string): string {
  return userAgent.trim().split(/[\s/]/, 1)[0]?.toLowerCase() ?? ''
}

function pathMatches(pathWithQuery: string, pattern: string): boolean {
  if (!pattern) return false
  const endAnchored = pattern.endsWith('$')
  const source = endAnchored ? pattern.slice(0, -1) : pattern
  const escaped = source.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')
  const matcher = new RegExp(`^${escaped}${endAnchored ? '$' : ''}`)
  return matcher.test(pathWithQuery)
}

export function isRobotsPathAllowed(
  contents: string,
  url: URL,
  userAgent: string,
): boolean {
  const token = userAgentToken(userAgent)
  const groups = parseRobotsTxt(contents)
  const scored = groups
    .map((group) => {
      const matchingAgents = group.agents.filter(
        (agent) => agent === '*' || token.startsWith(agent),
      )
      const score = matchingAgents.reduce(
        (maximum, agent) => Math.max(maximum, agent === '*' ? 0 : agent.length),
        -1,
      )
      return { group, score }
    })
    .filter(({ score }) => score >= 0)

  if (scored.length === 0) return true
  const bestScore = Math.max(...scored.map(({ score }) => score))
  const rules = scored
    .filter(({ score }) => score === bestScore)
    .flatMap(({ group }) => group.rules)
  const path = `${url.pathname}${url.search}`
  const matchingRules = rules.filter((rule) => pathMatches(path, rule.path))
  if (matchingRules.length === 0) return true
  matchingRules.sort((left, right) => {
    const lengthDifference = right.path.length - left.path.length
    if (lengthDifference !== 0) return lengthDifference
    return left.directive === 'allow' ? -1 : 1
  })
  return matchingRules[0]?.directive === 'allow'
}
