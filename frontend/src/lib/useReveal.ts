import { useEffect } from 'react'

/**
 * Reveals [data-reveal] elements as they scroll into view.
 *
 * The `js-reveal` class is added by this hook, not written into the HTML, so
 * the page renders fully visible when JS is unavailable or still loading —
 * the animation is an enhancement, never a gate on reading the content.
 */
export function useReveal() {
  useEffect(() => {
    const root = document.documentElement
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced || !('IntersectionObserver' in window)) return

    root.classList.add('js-reveal')

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const el = entry.target as HTMLElement
          const delay = Number(el.dataset.revealDelay ?? 0)
          window.setTimeout(() => el.classList.add('is-visible'), delay)
          observer.unobserve(el)
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.1 }
    )

    const targets = document.querySelectorAll<HTMLElement>('[data-reveal]')
    targets.forEach((el) => observer.observe(el))

    return () => {
      observer.disconnect()
      root.classList.remove('js-reveal')
    }
  }, [])
}
