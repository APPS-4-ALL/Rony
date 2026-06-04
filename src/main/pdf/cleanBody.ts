/**
 * Reduce a raw email body down to its latest, readable message for the
 * generated receipt PDF.
 *
 * Email bodies arrive as the WHOLE reply thread: the most recent message on top,
 * then quoted history, Outlook "From:/Sent:/To:" header blocks, `cid:` inline-
 * image references, and tracking-rewritten (Checkpoint) URLs broken across
 * lines. Dumping all of that makes the PDF read like a forwarded thread, not a
 * receipt. We keep only the top message and strip the noise. Pure + unit-tested
 * (no Electron/Node imports) so it stays cheap and safe.
 */

/** Default cap on the cleaned body (used for the in-app popup view). */
export const DEFAULT_MAX_LENGTH = 2000

/** A line that marks the start of quoted reply history (everything below it). */
function isReplyBoundary(line: string): boolean {
  const l = line.trim()
  return (
    /^_{5,}$/.test(l) || // Outlook's underscore separator
    /^>/.test(l) || // a quoted line
    /^(from|sent|to|cc|subject)\s*:/i.test(l) || // English reply header block
    /^(מאת|נשלח|אל|עותק|נושא)\s*:/.test(l) || // Hebrew reply header block
    /^(get|קבל)\s+outlook/i.test(l) || // mobile-app footer ("Get/קבל Outlook…")
    /^on\b.*\bwrote:\s*$/i.test(l) || // Gmail/Apple Mail "On <date>, <name> wrote:"
    /כתב(\/?ה)?\s*:\s*$/.test(l) // Hebrew Gmail "…, <name> כתב/ה:"
  )
}

/** A leftover noise line (inline-image ref or tracking-URL fragment) to drop. */
function isNoiseLine(line: string): boolean {
  const l = line.trim()
  if (l.length === 0) return false // keep blank lines for paragraph spacing
  return (
    /protect\.checkpoint\.com/i.test(l) || // tracking-rewrite host
    /^https?:\/\/\S{60,}$/i.test(l) || // a lone, very long URL
    /^[A-Za-z0-9+/_=<>.-]{30,}$/.test(l) // a base64-ish URL continuation line
  )
}

/**
 * Keep the latest message of a reply thread and remove inline-image refs and
 * tracking-URL fragments. Returns trimmed text, capped at `maxLength`. The cap
 * is generous for the generated PDF (the text IS the document) and tighter for
 * the in-app popup; callers pass it explicitly.
 */
export function cleanReceiptBody(body: string, maxLength: number = DEFAULT_MAX_LENGTH): string {
  const lines = body.split(/\r?\n/)

  // 1. Cut at the first reply boundary — everything after it is quoted history.
  let cut = lines.length
  for (let i = 0; i < lines.length; i++) {
    if (isReplyBoundary(lines[i])) {
      cut = i
      break
    }
  }

  // 2. From the latest message, drop cid: refs and tracking-URL noise.
  const cleaned = lines
    .slice(0, cut)
    // Inline-image markers — brackets may sit either side and in either order
    // (RTL text renders "[cid:x]" as "]cid:x["), so consume an optional bracket
    // of either kind before and after the token.
    .map((l) => l.replace(/[[\]]?cid:[^\s[\]]+[[\]]?/gi, '').trimEnd())
    .filter((l) => !isNoiseLine(l))

  // 3. Collapse blank runs, trim, and cap the length.
  const text = cleaned
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text
}
