import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './CodeBlock'

interface MarkdownRendererProps {
  content: string
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-text-primary [&_a]:text-accent [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code(props) {
            const { className, children } = props
            const match = /language-(\w+)/.exec(className ?? '')
            const isBlock = Boolean(match) || String(children).includes('\n')
            if (!isBlock) {
              return (
                <code className="rounded bg-bg-raised px-1.5 py-0.5 font-mono text-[13px] text-text-primary">
                  {children}
                </code>
              )
            }
            return (
              <CodeBlock
                code={String(children).replace(/\n$/, '')}
                language={match?.[1] ?? 'text'}
              />
            )
          },
          p({ children }) {
            return <p>{children}</p>
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
