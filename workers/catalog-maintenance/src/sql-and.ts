/** Group an already separated, nonempty list of pure SQL predicates. This is
 * not a SQL parser: leaves and their parameter order stay byte-for-byte intact.
 * Balanced AND depth grows logarithmically instead of one level per clause. */
export function sqlAnd(clauses: readonly string[]): string {
  if (!clauses.length) throw new Error('sql_and_requires_clause')
  const join = (start: number, end: number): string => {
    if (end - start === 1) return clauses[start]
    const middle = start + Math.floor((end - start) / 2)
    return `(${join(start, middle)} AND ${join(middle, end)})`
  }
  return join(0, clauses.length)
}
