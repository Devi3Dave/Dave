import type { SVGProps } from 'react'

const base = (p: SVGProps<SVGSVGElement>) => ({
  width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, ...p,
})

type P = SVGProps<SVGSVGElement>
export const IconText = (p: P) => (
  <svg {...base(p)} strokeWidth={0} fill="currentColor"><text x="12" y="17" textAnchor="middle" fontSize="13" fontWeight="600" fontFamily="Helvetica, Arial">Abc</text></svg>
)
export const IconCheck = (p: P) => <svg {...base(p)}><path d="M4 13l5 5L20 6" /></svg>
export const IconCross = (p: P) => <svg {...base(p)}><path d="M6 6l12 12M18 6L6 18" /></svg>
export const IconDot = (p: P) => <svg {...base(p)}><circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none" /></svg>
export const IconLine = (p: P) => <svg {...base(p)}><path d="M4 12h16" /></svg>
export const IconRect = (p: P) => <svg {...base(p)}><rect x="3.5" y="7" width="17" height="10" rx="2" /></svg>
export const IconPen = (p: P) => (
  <svg {...base(p)}><path d="M3 21c3-1 4-3 6-3s2 2 4 2 3-2 5-2" /><path d="M14.5 4.5l3 3L9 16l-4 1 1-4z" /></svg>
)
export const IconPerson = (p: P) => <svg {...base(p)}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>
export const IconCalendar = (p: P) => <svg {...base(p)}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
export const IconUndo = (p: P) => <svg {...base(p)}><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 010 10h-3" /></svg>
export const IconRedo = (p: P) => <svg {...base(p)}><path d="M15 14l5-5-5-5" /><path d="M20 9H9a5 5 0 000 10h3" /></svg>
export const IconShare = (p: P) => <svg {...base(p)}><path d="M12 3v13M7 8l5-5 5 5" /><path d="M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" /></svg>
export const IconBack = (p: P) => <svg {...base(p)}><path d="M15 18l-6-6 6-6" /></svg>
export const IconTrash = (p: P) => <svg {...base(p)}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
export const IconPlus = (p: P) => <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>
export const IconCamera = (p: P) => <svg {...base(p)}><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
export const IconDoc = (p: P) => <svg {...base(p)}><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /></svg>
export const IconMore = (p: P) => <svg {...base(p)}><circle cx="5" cy="12" r="1.5" fill="currentColor" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><circle cx="19" cy="12" r="1.5" fill="currentColor" /></svg>
export const IconZoomIn = (p: P) => <svg {...base(p)}><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.5-4.5M8 11h6M11 8v6" /></svg>
export const IconZoomOut = (p: P) => <svg {...base(p)}><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.5-4.5M8 11h6" /></svg>
