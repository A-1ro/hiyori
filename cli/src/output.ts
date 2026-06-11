export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2))
}

export function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) => {
    const maxRow = rows.reduce((m, r) => Math.max(m, (r[i] ?? '').length), 0)
    return Math.max(h.length, maxRow)
  })

  const pad = (s: string, w: number) => s.padEnd(w)

  const headerLine = headers.map((h, i) => pad(h, widths[i] ?? 0)).join('  ')
  const separator = widths.map((w) => '-'.repeat(w)).join('  ')
  console.log(headerLine)
  console.log(separator)
  for (const row of rows) {
    console.log(row.map((cell, i) => pad(cell, widths[i] ?? 0)).join('  '))
  }
}

export function fail(message: string, code = 1): void {
  console.error(message)
  process.exitCode = code
}
