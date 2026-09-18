import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Undo2 } from 'lucide-react'

export interface ToastState {
  message: string
  onUndo?: () => void
}

/** Transient confirmation for actions that would otherwise happen silently. */
export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const show = useCallback((next: ToastState) => {
    window.clearTimeout(timer.current)
    setToast(next)
    timer.current = window.setTimeout(() => setToast(null), 5000)
  }, [])

  const dismiss = useCallback(() => {
    window.clearTimeout(timer.current)
    setToast(null)
  }, [])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return { toast, show, dismiss }
}

export function Toast({ toast, onDismiss }: { toast: ToastState | null; onDismiss: () => void }) {
  if (!toast) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-border-subtle bg-bg-surface px-4 py-2.5 shadow-lg"
    >
      <Check size={15} className="text-severity-success" />
      <span className="text-[13.5px]">{toast.message}</span>
      {toast.onUndo && (
        <button
          onClick={() => {
            toast.onUndo?.()
            onDismiss()
          }}
          className="flex items-center gap-1.5 rounded-md border border-border-subtle px-2 py-1 text-[12.5px] font-medium transition-colors hover:bg-bg-raised"
        >
          <Undo2 size={12} />
          Undo
        </button>
      )}
    </div>
  )
}
