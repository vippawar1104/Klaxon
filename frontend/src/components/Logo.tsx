interface LogoProps {
  size?: number
  className?: string
}

/** A klaxon: horn plus the waves coming out of it. */
export function LogoMark({ size = 24, className = '' }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M3 9.5h3.6L12.8 4v16l-6.2-5.5H3z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M16.2 9.2a4.2 4.2 0 0 1 0 5.6"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <path
        d="M19.3 6.4a8.2 8.2 0 0 1 0 11.2"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Bold, tight, sentence case — plain and legible rather than the
 * uppercase/wide-letterspace treatment this used to share with Sentry's. */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-sans font-bold tracking-tight leading-none ${className}`}>Klaxon</span>
  )
}
