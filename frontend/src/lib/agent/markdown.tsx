import { type ReactNode } from 'react'

/**
 * Minimal inline Markdown renderer for agent chat messages.
 *
 * Supports: **bold**, *italic*, `code`, and line breaks. This is deliberately
 * NOT a full Markdown parser — the agent's system prompt constrains it to
 * short, structured responses, so a 40-line renderer covers >99% of what the
 * model actually emits without pulling a dependency like react-markdown
 * (which would add ~50KB to the bundle for this single use case).
 *
 * If the model ever starts emitting tables, lists, or links, swap this for a
 * real library; the interface (renderMarkdown → ReactNode) stays the same.
 */
export function renderMarkdown(text: string): ReactNode {
  const lines = text.split('\n')
  return lines.map((line, lineIndex) => (
    <span key={lineIndex}>
      {lineIndex > 0 && <br />}
      {renderInline(line)}
    </span>
  ))
}

function renderInline(text: string): ReactNode[] {
  // Split on **bold**, *italic*, and `code` while keeping the delimiters.
  const tokens = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g)
  return tokens.map((token, i) => {
    if (token.startsWith('**') && token.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold">
          {token.slice(2, -2)}
        </strong>
      )
    }
    if (token.startsWith('`') && token.endsWith('`')) {
      return (
        <code key={i} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">
          {token.slice(1, -1)}
        </code>
      )
    }
    if (token.startsWith('*') && token.endsWith('*') && token.length > 2) {
      return (
        <em key={i} className="italic">
          {token.slice(1, -1)}
        </em>
      )
    }
    return token
  })
}
