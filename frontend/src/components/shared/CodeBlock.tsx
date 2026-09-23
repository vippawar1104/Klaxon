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
    // themes (plural) + defaultColor: false makes Shiki emit BOTH palettes as
    // --shiki-light/--shiki-dark CSS variables on every token, instead of
    // baking one theme's colors in as a fixed inline color. A single
    // `theme: 'github-light-default'` was the bug here: those colors are
    // tuned for a white background and go near-illegible on the dashboard's
    // dark surface, because nothing about them responds to the .dark class
    // the rest of the dashboard's theme already switches on. The actual
    // switch happens in index.css, off that same .dark class.
    codeToHtml(code, {
      lang: language,
      themes: { light: 'github-light-default', dark: 'github-dark-default' },
      defaultColor: false,
    })
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
