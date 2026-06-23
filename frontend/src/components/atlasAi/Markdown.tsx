import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'

export const atlasAiMarkdownComponents: Components = {
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
  code({ inline, className, children, ...props }: any) {
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

export const atlasAiMarkdownPlugins = [remarkGfm]

export function AtlasAiMarkdown({ children, className }: { children: string; className?: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={atlasAiMarkdownPlugins}
      components={atlasAiMarkdownComponents}
      className={className}
    >
      {children}
    </ReactMarkdown>
  )
}

export type { Components as AtlasAiMarkdownComponentsType } from 'react-markdown'
