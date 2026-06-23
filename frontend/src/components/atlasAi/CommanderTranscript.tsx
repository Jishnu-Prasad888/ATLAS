import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import type { CommanderTurn } from '@/api/commander'

const markdownComponents: Components = {
  p: ({ children, ...props }) => (
    <p className="mb-2 leading-relaxed text-[--color-text] last:mb-0" {...props}>
      {children}
    </p>
  ),
  ul: ({ children, ...props }) => (
    <ul className="mb-2 list-disc space-y-1 pl-5 text-[--color-text] last:mb-0" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className="mb-2 list-decimal space-y-1 pl-5 text-[--color-text] last:mb-0" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className="marker:text-[#8fbaf9] [&>p]:mb-0" {...props}>
      {children}
    </li>
  ),
  a: ({ children, href, ...props }) => (
    <a
      href={href}
      className="text-[#8fbaf9] underline decoration-[#8fbaf9]/70 underline-offset-4 transition hover:text-[#b8d2ff]"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
  code({ inline, className, children, ...props }) {
    const content = String(children).replace(/\n$/, '')
    if (inline) {
      return (
        <code className="rounded bg-[#1c2d44] px-1.5 py-0.5 text-[12px] text-[#d6e3ff]" {...props}>
          {content}
        </code>
      )
    }
    return (
      <pre className="mb-3 overflow-x-auto rounded-md bg-[#101a29] px-3 py-2 text-[12px] leading-relaxed text-[#d6e3ff]" {...props}>
        <code className={className}>{content}</code>
      </pre>
    )
  },
  blockquote: ({ children, ...props }) => (
    <blockquote className="mb-2 border-l-2 border-[#3f5879] pl-3 text-[--color-text]" {...props}>
      {children}
    </blockquote>
  ),
  hr: (props) => <hr className="my-3 border-t border-[--color-border]" {...props} />,
}

const markdownPlugins = [remarkGfm]

interface CommanderTranscriptProps {
  transcript: CommanderTurn[]
  hideSystem?: boolean
}

export function CommanderTranscript({ transcript, hideSystem = true }: CommanderTranscriptProps) {
  const filtered = hideSystem ? transcript.filter((turn) => turn.role !== 'system') : transcript

  if (filtered.length === 0) {
    return <p className="text-xs font-mono text-[--color-text-dim]">No messages yet. Ask a question to get started.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      {filtered.map((turn, idx) => (
        <div
          key={`${turn.role}-${idx}`}
          className="rounded border border-[--color-border] bg-[--color-surface] px-3 py-2 text-xs font-mono text-[--color-text]"
        >
          <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-[--color-text-dim]">
            <span>{turn.role}</span>
            {turn.name && <span className="text-[--color-text-muted] lowercase">{turn.name}</span>}
            {turn.tool_call_id && <span className="text-[--color-text-muted] lowercase">#{turn.tool_call_id}</span>}
          </div>
          {turn.content && (
            <ReactMarkdown remarkPlugins={markdownPlugins} components={markdownComponents} className="whitespace-pre-wrap leading-relaxed text-[--color-text]">
              {turn.content}
            </ReactMarkdown>
          )}
          {turn.tool_calls && turn.tool_calls.length > 0 && (
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-[--color-bg] px-2 py-1 text-[10px] text-[--color-text-muted]">
              {JSON.stringify(turn.tool_calls, null, 2)}
            </pre>
          )}
        </div>
      ))}
    </div>
  )
}
