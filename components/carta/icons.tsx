import type React from "react"

/** Line icons of artboard 01 (24 px grid, 2 px stroke). Decorative only. */

function Svg({ children, className = "h-5 w-5" }: { children: React.ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true" focusable="false" className={className}>
      {children}
    </svg>
  )
}

export const SearchIcon = (p: { className?: string }) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
)

export const InstagramIcon = (p: { className?: string }) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r="1" fill="currentColor" />
  </Svg>
)

export const TiktokIcon = (p: { className?: string }) => (
  <Svg {...p}>
    <path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5" />
    <path d="M14 3c.5 3 2.5 5 5.5 5" />
  </Svg>
)

export const WhatsappIcon = (p: { className?: string }) => (
  <Svg {...p}>
    <path d="M4 20l1.3-3.8A8 8 0 1 1 8 19z" />
    <path d="M9 9.5c.5 2 2.5 4 4.5 4.5l1-1.2 2 .9c-.2 1.3-1.2 2-2.5 1.8C11 15 9 13 8.5 10.3 8.3 9 9 8 10.3 7.8l.9 2z" />
  </Svg>
)

export const MapIcon = (p: { className?: string }) => (
  <Svg {...p}>
    <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </Svg>
)

export const ShareIcon = (p: { className?: string }) => (
  <Svg {...p}>
    <path d="M12 15V3" />
    <path d="m7 8 5-5 5 5" />
    <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
  </Svg>
)

export const MenuIcon = (p: { className?: string }) => (
  <Svg {...p}>
    <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" />
    <path d="M9 9h6M9 13h6" />
  </Svg>
)

export const ListIcon = (p: { className?: string }) => (
  <Svg {...p}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <circle cx="4.5" cy="6" r="1" />
    <circle cx="4.5" cy="12" r="1" />
    <circle cx="4.5" cy="18" r="1" />
  </Svg>
)

export const LinkIcon = (p: { className?: string }) => (
  <Svg {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Svg>
)

export const BillIcon = (p: { className?: string }) => (
  <Svg {...p}>
    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
    <path d="M9 8h6M9 12h6" />
  </Svg>
)
