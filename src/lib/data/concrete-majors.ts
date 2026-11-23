import type { Program } from './types'

/** Language tracks and admission rounds do not create another concrete major. */
export function concreteProgramKeys(program: Program): string[] {
  const names = [program.name.zh, program.name.en].filter((name): name is string => Boolean(name))
  const genericEnglish = /^(?:international\s+)?(?:(?:english|chinese)[- ](?:taught|medium)\s+)?(?:undergraduate|graduate|postgraduate|bachelor(?:'?s)?|master(?:'?s)?|doctoral|degree)\s+(?:program(?:me)?s?|admissions?)(?:\s+guide)?$/iu
  const genericChinese = /^(?:国际学生|留学生)?(?:(?:全?[英中]|英文|英语|中文|汉语)授课)?(?:本科|硕士|博士|研究生|学历)(?:招生|项目|专业|目录|指南)(?:简章|目录|指南)?$/u
  if (!names.length || names.every(name => genericEnglish.test(name.trim()) || genericChinese.test(name.trim()))) return []
  const normalize = (name: string) => name.normalize('NFKC').toLowerCase()
    .replace(/\((?:english|chinese)(?:[- ](?:taught|medium))?\)|(?:english|chinese)[- ](?:taught|medium)|[（(](?:中文|英文|汉语|英语)(?:授课|教学)?[）)]/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
  return [...new Set(names.map(normalize).filter(Boolean))].map(name => `${program.degreeLevel}:${name}`)
}

export function distinctPrograms(programs: Program[]): string[] {
  const groups: Array<{ ids: string[]; keys: Set<string> }> = []
  for (const program of [...programs].sort((a, b) => a.id.localeCompare(b.id))) {
    const keys = concreteProgramKeys(program)
    if (!keys.length) continue
    const matches = groups.filter(group => keys.some(key => group.keys.has(key)))
    const group = matches[0] ?? { ids: [], keys: new Set<string>() }
    if (!matches.length) groups.push(group)
    group.ids.push(program.id); keys.forEach(key => group.keys.add(key))
    for (const other of matches.slice(1)) {
      group.ids.push(...other.ids); other.keys.forEach(key => group.keys.add(key)); groups.splice(groups.indexOf(other), 1)
    }
  }
  return groups.map(group => group.ids.sort()[0]).sort()
}
