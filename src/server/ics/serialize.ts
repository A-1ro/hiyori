export function formatICalDateTime(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

export function escapeICalText(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

export function foldICalLine(line: string): string {
  const encoder = new TextEncoder()
  const MAX_OCTETS = 75

  const bytes = encoder.encode(line)
  if (bytes.length <= MAX_OCTETS) {
    return line
  }

  const codePoints = [...line]
  const result: string[] = []
  let currentLine = ''
  let currentBytes = 0

  for (const cp of codePoints) {
    const cpBytes = encoder.encode(cp).length
    if (currentBytes + cpBytes > MAX_OCTETS) {
      result.push(currentLine)
      currentLine = ' ' + cp
      currentBytes = 1 + cpBytes
    } else {
      currentLine += cp
      currentBytes += cpBytes
    }
  }

  if (currentLine.length > 0) {
    result.push(currentLine)
  }

  return result.join('\r\n')
}

export function eventToVEvent(args: {
  event: { id: string; title: string; description?: string | null }
  decision: { icsUid: string; icsSequence: number; decidedAt: Date; cancelledAt?: Date | null }
  candidate: { startAt: Date; endAt: Date }
  now?: Date
}): string[] {
  // DTSTAMP は iCalendar オブジェクトの「最終改訂時刻」。このフィードは確定イベントの配信なので、
  // イベントの安定した最終更新時刻を使う: 取消済みなら cancelledAt、通常は decidedAt。
  // 以前は new Date()（秒精度の現在時刻）を焼き込んでいたため、本文が同一でも秒ごとに DTSTAMP が
  // 変わり、本文ハッシュ由来の ETag が揺れて If-None-Match の 304 が実質機能していなかった。
  // 安定値にすることで、イベント内容が変わらない限り DTSTAMP も ETag も一定になる。
  // 明示的に now が渡された場合はそれを優先（テスト等の決定的検証用）。
  const { event, decision, candidate } = args
  const now = args.now ?? decision.cancelledAt ?? decision.decidedAt

  const lines: string[] = [
    'BEGIN:VEVENT',
    `UID:${decision.icsUid}`,
    `DTSTAMP:${formatICalDateTime(now)}`,
    `DTSTART:${formatICalDateTime(candidate.startAt)}`,
    `DTEND:${formatICalDateTime(candidate.endAt)}`,
    `SEQUENCE:${decision.icsSequence}`,
    `SUMMARY:${escapeICalText(event.title)}`,
  ]

  if (event.description != null && event.description !== '') {
    lines.push(`DESCRIPTION:${escapeICalText(event.description)}`)
  }

  lines.push(decision.cancelledAt != null ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED')
  lines.push('END:VEVENT')

  return lines
}

export function wrapInVCalendar(vevents: string[][]): string {
  const header = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Hiyori//Hiyori//JA',
    'METHOD:PUBLISH',
    'CALSCALE:GREGORIAN',
  ]

  const footer = ['END:VCALENDAR']

  const allLines = [...header, ...vevents.flat(), ...footer]

  return allLines.map(foldICalLine).join('\r\n') + '\r\n'
}
