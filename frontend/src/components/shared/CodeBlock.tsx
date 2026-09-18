import { useEffect, useState } from 'react'
import { codeToHtml } from 'shiki'
import { Check, Copy } from 'lucide-react'

interface CodeBlockProps {
  code: string
  language?: string
}

export function CodeBlock({ code, language = 'python' }: CodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    codeToHtml(code, { lang: language, theme: 'github-light-default' })
      .then((result) => {
        if (!cancelled) setHtml(result)
      })
      .catch(() => {
        if (!cancelled) setHtml(null)
      })
    return () => {
      cancelled = true
    }
  }, [code, language])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="relative my-3 overflow-hidden rounded-lg border border-border-subtle bg-bg-surface">
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-1.5">
        <span className="font-mono text-xs text-text-tertiary">{language}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {html ? (
        <div className="overflow-x-auto text-sm [&>pre]:!bg-transparent [&>pre]:p-3" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="overflow-x-auto p-3 font-mono text-sm text-text-primary">{code}</pre>
      )}
    </div>
  )
}
