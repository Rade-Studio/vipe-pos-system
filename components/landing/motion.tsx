"use client"

import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react"
import { cn } from "@/lib/utils"

// Dependency-free scroll motion primitives for the landing page.
// Every hook degrades to the final state when the browser lacks the API
// (SSR, jsdom) or the user asked for reduced motion.

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    setReduced(query.matches)
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches)
    query.addEventListener?.("change", onChange)
    return () => query.removeEventListener?.("change", onChange)
  }, [])
  return reduced
}

export function useInView<T extends Element>(options: { once?: boolean; threshold?: number; rootMargin?: string } = {}) {
  const { once = true, threshold = 0.2, rootMargin = "0px 0px -10% 0px" } = options
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (typeof IntersectionObserver === "undefined") {
      setInView(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true)
          if (once) observer.disconnect()
        } else if (!once) {
          setInView(false)
        }
      },
      { threshold, rootMargin },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [once, threshold, rootMargin])

  return [ref, inView] as const
}

/**
 * Progress (0..1) of an element scrolling through the viewport.
 * "sticky" measures a tall container whose child is position: sticky:
 * 0 when its top hits the viewport top, 1 when its bottom hits the viewport bottom.
 * "through" measures from the element entering the bottom edge to leaving the top edge.
 */
export function useScrollProgress<T extends HTMLElement>(mode: "sticky" | "through" = "sticky"): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const node = ref.current
    if (!node || typeof window === "undefined") return
    let frame = 0

    const measure = () => {
      frame = 0
      const rect = node.getBoundingClientRect()
      const viewport = window.innerHeight || 1
      const raw =
        mode === "sticky"
          ? -rect.top / Math.max(rect.height - viewport, 1)
          : (viewport - rect.top) / (rect.height + viewport)
      setProgress(Math.min(1, Math.max(0, raw)))
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }

    measure()
    window.addEventListener("scroll", schedule, { passive: true })
    window.addEventListener("resize", schedule)
    return () => {
      window.removeEventListener("scroll", schedule)
      window.removeEventListener("resize", schedule)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [mode])

  return [ref, progress]
}

export function usePageScroll() {
  const [state, setState] = useState({ y: 0, progress: 0 })
  useEffect(() => {
    let frame = 0
    const measure = () => {
      frame = 0
      const max = document.documentElement.scrollHeight - window.innerHeight
      setState({ y: window.scrollY, progress: max > 0 ? window.scrollY / max : 0 })
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener("scroll", schedule, { passive: true })
    window.addEventListener("resize", schedule)
    return () => {
      window.removeEventListener("scroll", schedule)
      window.removeEventListener("resize", schedule)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])
  return state
}

type RevealVariant = "up" | "down" | "left" | "right" | "zoom" | "blur"

const hidden: Record<RevealVariant, string> = {
  up: "translate3d(0, 48px, 0)",
  down: "translate3d(0, -48px, 0)",
  left: "translate3d(-64px, 0, 0)",
  right: "translate3d(64px, 0, 0)",
  zoom: "scale(0.88)",
  blur: "scale(1.04)",
}

export function Reveal({
  children,
  className,
  delay = 0,
  variant = "up",
  as: Tag = "div",
}: {
  children: ReactNode
  className?: string
  delay?: number
  variant?: RevealVariant
  as?: "div" | "li" | "span" | "article" | "section"
}) {
  const [ref, inView] = useInView<HTMLDivElement>()
  const reduced = usePrefersReducedMotion()
  const shown = inView || reduced
  const style: CSSProperties = {
    opacity: shown ? 1 : 0,
    transform: shown ? "none" : hidden[variant],
    filter: variant === "blur" && !shown ? "blur(12px)" : "none",
    transition: reduced
      ? "none"
      : `opacity 900ms cubic-bezier(.16,1,.3,1) ${delay}ms, transform 900ms cubic-bezier(.16,1,.3,1) ${delay}ms, filter 900ms ease ${delay}ms`,
    willChange: "opacity, transform",
  }
  // The polymorphic tags all accept an HTMLElement ref; narrow to div for typing.
  const Component = Tag as "div"
  return (
    <Component ref={ref} className={className} style={style}>
      {children}
    </Component>
  )
}

/**
 * Splits a line into words that rise one after another.
 * className is applied per word: background-clip text effects do not paint
 * through transformed children, so each moving word carries its own styles.
 */
export function SplitWords({ text, className, delay = 0, step = 70 }: { text: string; className?: string; delay?: number; step?: number }) {
  const [ref, inView] = useInView<HTMLSpanElement>({ threshold: 0.4 })
  const reduced = usePrefersReducedMotion()
  const shown = inView || reduced
  return (
    <span ref={ref} className="inline" aria-label={text}>
      {text.split(" ").map((word, index) => (
        <span key={`${word}-${index}`} aria-hidden className="inline-block overflow-hidden pb-[0.12em] align-bottom">
          <span
            className={cn("inline-block", className)}
            style={{
              transform: shown ? "none" : "translate3d(0, 110%, 0) rotate(6deg)",
              transition: reduced ? "none" : `transform 1000ms cubic-bezier(.16,1,.3,1) ${delay + index * step}ms`,
            }}
          >
            {word}
            {"\u00A0"}
          </span>
        </span>
      ))}
    </span>
  )
}

export function CountUp({ to, duration = 1600, suffix = "" }: { to: number; duration?: number; suffix?: string }) {
  const [ref, inView] = useInView<HTMLSpanElement>({ threshold: 0.6 })
  const reduced = usePrefersReducedMotion()
  const [value, setValue] = useState(to)

  useEffect(() => {
    if (!inView || reduced || to === 0) return
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      setValue(Math.round(to * (1 - Math.pow(1 - t, 3))))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    setValue(0)
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [inView, reduced, to, duration])

  return (
    <span ref={ref}>
      {value}
      {suffix}
    </span>
  )
}

/** Card that tilts toward the cursor and paints a spotlight under it. */
export function TiltCard({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const reduced = usePrefersReducedMotion()

  const onMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const node = ref.current
    if (!node || reduced || event.pointerType !== "mouse") return
    const rect = node.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width
    const y = (event.clientY - rect.top) / rect.height
    node.style.setProperty("--mx", `${x * 100}%`)
    node.style.setProperty("--my", `${y * 100}%`)
    node.style.transform = `perspective(900px) rotateX(${(0.5 - y) * 10}deg) rotateY(${(x - 0.5) * 12}deg)`
  }
  const onLeave = () => {
    if (ref.current) ref.current.style.transform = "perspective(900px) rotateX(0) rotateY(0)"
  }

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className={cn("lp-spotlight relative transition-transform duration-300 ease-out [transform-style:preserve-3d]", className)}
    >
      {children}
    </div>
  )
}

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/** Maps progress inside [start, end] to 0..1. */
export const segment = (progress: number, start: number, end: number) => clamp01((progress - start) / (end - start))
