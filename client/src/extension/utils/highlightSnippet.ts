type TextRange = {
  start: number
  end: number
}

type IndexedTextNode = {
  node: Text
  start: number
  end: number
}

const HIGHLIGHT_ATTR = 'data-email-filer-highlight'

function clearExistingHighlightMarks() {
  const marks = document.querySelectorAll(`mark[${HIGHLIGHT_ATTR}]`)
  marks.forEach((mark) => {
    const parent = mark.parentNode
    if (!parent) return
    const textNode = document.createTextNode(mark.textContent ?? '')
    parent.replaceChild(textNode, mark)
    parent.normalize()
  })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function findRangesByWhitespaceRegex(source: string, query: string): TextRange[] {
  const parts = query.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return []

  const pattern = parts.map((part) => escapeRegExp(part)).join('\\s+')
  const regex = new RegExp(pattern, 'gi')
  const ranges: TextRange[] = []
  for (const match of source.matchAll(regex)) {
    const text = match[0]
    if (!text || match.index === undefined) continue
    ranges.push({ start: match.index, end: match.index + text.length })
  }
  return ranges
}

function toWordTokens(text: string): Array<{ token: string; start: number; end: number }> {
  const matches = text.matchAll(/[a-z0-9]+/gi)
  const tokens: Array<{ token: string; start: number; end: number }> = []
  for (const match of matches) {
    const token = match[0]
    if (!token || match.index === undefined) continue
    tokens.push({
      token: token.toLowerCase(),
      start: match.index,
      end: match.index + token.length,
    })
  }
  return tokens
}

function findRangesByWordSequence(source: string, query: string): TextRange[] {
  const queryTokens = toWordTokens(query).map((item) => item.token)
  if (queryTokens.length === 0) return []

  const sourceTokens = toWordTokens(source)
  const ranges: TextRange[] = []

  for (let i = 0; i <= sourceTokens.length - queryTokens.length; i += 1) {
    let matched = true
    for (let j = 0; j < queryTokens.length; j += 1) {
      if (sourceTokens[i + j].token !== queryTokens[j]) {
        matched = false
        break
      }
    }
    if (!matched) continue

    const start = sourceTokens[i].start
    const end = sourceTokens[i + queryTokens.length - 1].end
    ranges.push({ start, end })
  }

  return ranges
}

function mergeRanges(ranges: TextRange[]): TextRange[] {
  if (ranges.length <= 1) return ranges
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: TextRange[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i]
    const previous = merged[merged.length - 1]
    if (current.start <= previous.end) {
      previous.end = Math.max(previous.end, current.end)
      continue
    }
    merged.push({ ...current })
  }
  return merged
}

function shouldInsertBoundarySeparator(previous: string, next: string): boolean {
  if (!previous || !next) return false
  const prevChar = previous[previous.length - 1]
  const nextChar = next[0]
  const prevIsWord = /[a-z0-9]/i.test(prevChar)
  const nextIsWord = /[a-z0-9]/i.test(nextChar)
  return prevIsWord && nextIsWord
}

function createDocumentTextIndex(textNodes: Text[]): {
  fullText: string
  segments: IndexedTextNode[]
} {
  const chunks: string[] = []
  const segments: IndexedTextNode[] = []
  let cursor = 0
  let previousText = ''

  for (const node of textNodes) {
    const value = node.textContent ?? ''
    if (!value) continue

    if (shouldInsertBoundarySeparator(previousText, value)) {
      chunks.push(' ')
      cursor += 1
    }

    const start = cursor
    const end = start + value.length
    chunks.push(value)
    segments.push({ node, start, end })
    cursor = end
    previousText = value
  }

  return { fullText: chunks.join(''), segments }
}

export function applyHighlightToSnippet(snippetText: string): number {
  const query = snippetText.trim()
  if (!query) return 0

  const root = document.body
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const value = node.textContent ?? ''
      if (!value.trim()) return NodeFilter.FILTER_REJECT
      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      if (parent.closest('[data-email-filer-extension]')) return NodeFilter.FILTER_REJECT
      const tag = parent.tagName
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })

  const textNodes: Text[] = []
  let current = walker.nextNode()
  while (current) {
    textNodes.push(current as Text)
    current = walker.nextNode()
  }
  if (textNodes.length === 0) return 0

  const { fullText, segments } = createDocumentTextIndex(textNodes)
  if (!fullText) return 0

  const ranges = findRangesByWhitespaceRegex(fullText, query)
  const finalRanges = mergeRanges(
    ranges.length > 0 ? ranges : findRangesByWordSequence(fullText, query),
  )
  if (finalRanges.length === 0) return 0
  const logicalMatchCount = finalRanges.length

  clearExistingHighlightMarks()
  let firstMark: Element | null = null

  for (const segment of segments) {
    const source = segment.node.textContent ?? ''
    if (!source) continue

    const localRanges: TextRange[] = []
    for (const range of finalRanges) {
      if (range.end <= segment.start) continue
      if (range.start >= segment.end) break
      localRanges.push({
        start: Math.max(0, range.start - segment.start),
        end: Math.min(source.length, range.end - segment.start),
      })
    }
    if (localRanges.length === 0) continue

    const fragment = document.createDocumentFragment()
    let localCursor = 0
    for (const { start, end } of localRanges) {
      if (start > localCursor) {
        fragment.appendChild(document.createTextNode(source.slice(localCursor, start)))
      }
      if (end <= start) continue

      const mark = document.createElement('mark')
      mark.setAttribute(HIGHLIGHT_ATTR, '')
      mark.style.backgroundColor = '#fff176'
      mark.style.padding = '0 1px'
      mark.textContent = source.slice(start, end)
      fragment.appendChild(mark)
      if (!firstMark) firstMark = mark
      localCursor = end
    }

    if (localCursor < source.length) {
      fragment.appendChild(document.createTextNode(source.slice(localCursor)))
    }

    segment.node.parentNode?.replaceChild(fragment, segment.node)
  }

  if (firstMark !== null) {
    firstMark.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
  return firstMark ? logicalMatchCount : 0
}
