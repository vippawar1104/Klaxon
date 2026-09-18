import { AlertCircle } from 'lucide-react'

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-severity-error/30 bg-severity-error/10 px-3 py-2.5 text-sm text-severity-error">
      <AlertCircle size={15} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  )
}
