/**
 * Advance widths (px) of the G2 firmware font, measured from the Even Hub simulator by rendering
 * each glyph 20 times (tools/calibrate.html). Line pitch is 27 px, so the 288 px screen holds 10 rows.
 * Glyphs not listed are assumed to be full-width symbols; a 0 means the font drops the glyph.
 */
const WIDTHS: Record<string, number> = {" ": 5, "!": 4, "\"": 6, "#": 14, "$": 12, "%": 14, "&": 15, "'": 4, "(": 6, ")": 6, "*": 8, "+": 10, ",": 5, "-": 10, ".": 5, "/": 5, "0": 12, "1": 7, "2": 11, "3": 12, "4": 12, "5": 12, "6": 12, "7": 12, "8": 12, "9": 12, ":": 4, ";": 5, "<": 10, "=": 10, ">": 10, "?": 12, "@": 17, "A": 13, "B": 12, "C": 11, "D": 12, "E": 10, "F": 10, "G": 12, "H": 12, "I": 5, "J": 8, "K": 12, "L": 9, "M": 16, "N": 12, "O": 12, "P": 12, "Q": 12, "R": 12, "S": 11, "T": 10, "U": 12, "V": 13, "W": 16, "X": 13, "Y": 13, "Z": 12, "[": 7, "\\": 5, "]": 7, "^": 10, "_": 9, "`": 0, "a": 11, "b": 11, "c": 10, "d": 11, "e": 10, "f": 7, "g": 11, "h": 11, "i": 5, "j": 5, "k": 9, "l": 4, "m": 16, "n": 11, "o": 10, "p": 11, "q": 11, "r": 7, "s": 10, "t": 6, "u": 11, "v": 11, "w": 15, "x": 11, "y": 11, "z": 9, "{": 8, "|": 4, "}": 8, "~": 16, "●": 20, "○": 20, "■": 20, "□": 20, "★": 20, "☆": 20, "▲": 20, "△": 20, "▶": 20, "▷": 20, "▼": 20, "▽": 20, "◀": 20, "◁": 20, "━": 20, "─": 20, "│": 20, "┃": 20, "█": 20, "▇": 20, "▆": 20, "▅": 20, "▄": 20, "▃": 20, "▂": 20, "▁": 20, "╭": 20, "╮": 20, "╯": 20, "╰": 20, "·": 5, "…": 10, "—": 15, "–": 15}

export const LINE_PX = 27
/**
 * Headroom kept at the end of every line. The measured advances can run a few px short of what the
 * firmware draws over a long line, and a line that spills wraps and pushes everything below it down.
 */
export const SAFETY_PX = 14
export const SCREEN_W = 576
export const SCREEN_H = 288
const FALLBACK_PX = 20

export const charWidth = (char: string) => WIDTHS[char] ?? FALLBACK_PX

export function textWidth(text: string): number {
  let width = 0
  for (const char of text) width += charWidth(char)
  return width
}

/** Glyphs the font would silently drop are replaced so the text reads the same. */
export const renderable = (text: string) => text.replace(/`/g, "'").replace(/\t/g, '  ')

/** Like `fitWidth`, but keeps runs of spaces, so space-padded columns stay lined up. */
export function clipWidth(text: string, widthPx: number): string {
  const clean = renderable(text).replace(/\s+$/, '')
  if (textWidth(clean) <= widthPx - SAFETY_PX) return clean
  const budget = widthPx - SAFETY_PX - charWidth('…')
  let out = ''
  let used = 0
  for (const char of clean) {
    if (used + charWidth(char) > budget) break
    out += char
    used += charWidth(char)
  }
  return `${out.trimEnd()}…`
}

/** Truncates to `maxPx`, ending in an ellipsis when cut. */
export function fitWidth(text: string, widthPx: number): string {
  const maxPx = widthPx - SAFETY_PX
  const clean = renderable(text).replace(/\s+/g, ' ').trim()
  if (textWidth(clean) <= maxPx) return clean
  const budget = maxPx - charWidth('…')
  let out = ''
  let used = 0
  for (const char of clean) {
    const w = charWidth(char)
    if (used + w > budget) break
    out += char
    used += w
  }
  return `${out.trimEnd()}…`
}

/** Word-wraps to lines no wider than `maxPx`, hard-breaking words that are longer than a line. */
export function wrapWidth(text: string, widthPx: number): string[] {
  const maxPx = widthPx - SAFETY_PX
  const lines: string[] = []
  for (const paragraph of renderable(text).split('\n')) {
    let line = ''
    let lineW = 0
    const space = charWidth(' ')
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let rest = word
      let restW = textWidth(rest)
      while (restW > maxPx) {
        if (line) { lines.push(line); line = ''; lineW = 0 }
        let head = ''
        let headW = 0
        for (const char of rest) {
          if (headW + charWidth(char) > maxPx) break
          head += char
          headW += charWidth(char)
        }
        lines.push(head)
        rest = rest.slice(head.length)
        restW = textWidth(rest)
      }
      if (line && lineW + space + restW > maxPx) { lines.push(line); line = ''; lineW = 0 }
      line += (line ? ' ' : '') + rest
      lineW += (lineW ? space : 0) + restW
    }
    lines.push(line)
  }
  return lines
}
