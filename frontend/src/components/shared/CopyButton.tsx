import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'

interface Props {
  value: string
  label?: string
  className?: string
}

export function CopyButton({ value, label, className = '' }: Props) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(t)
  }, [copied])

  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
        } catch {
          /* clipboard blocked (insecure origin, denied permission) — stay silent */
        }
      }}
      aria-label={copied ? 'Copied' : `Copy ${label ?? 'to clipboard'}`}
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-text-secondary transition-colors hover:bg-bg-raised hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${className}`}
    >
      {copied ? <Check size={13} className="text-severity-success" /> : <Copy size={13} />}
      {label && <span>{copied ? 'Copied' : label}</span>}
    </button>
  )
}
