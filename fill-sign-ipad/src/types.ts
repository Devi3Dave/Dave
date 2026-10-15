// All geometry is in PDF points of the *displayed* (rotation-applied) page at scale 1,
// with the origin at the top-left corner. exportPdf.ts maps it back to PDF user space.

interface AnnBase {
  id: string
  page: number // 0-based
  x: number
  y: number
  color: string
}

export interface TextAnn extends AnnBase {
  kind: 'text'
  text: string
  fontSize: number
}

export type ShapeKind = 'check' | 'cross' | 'dot' | 'rect' | 'line'

export interface ShapeAnn extends AnnBase {
  kind: ShapeKind
  w: number
  h: number
}

export interface ImageAnn extends AnnBase {
  kind: 'image'
  role: 'signature' | 'initials'
  w: number
  h: number
  src: string // tinted PNG data URL
}

export type Ann = TextAnn | ShapeAnn | ImageAnn

export type Tool = 'text' | ShapeKind

export interface PageSize {
  w: number
  h: number
}

export interface DocMeta {
  id: string
  name: string
  pageCount: number
  thumb: string
  anns: Ann[]
  createdAt: number
  updatedAt: number
}

export interface SavedSignature {
  dataUrl: string // black ink on transparent background
  w: number
  h: number
}

export interface ProfileField {
  key: string
  label: string
  value: string
}

/** What gets dropped onto the page by the next tap. */
export type Stamp =
  | { kind: 'text'; text: string }
  | { kind: 'image'; role: 'signature' | 'initials'; sig: SavedSignature }

export const INK_COLORS = [
  { value: '#111111', label: 'Schwarz' },
  { value: '#1a3fb0', label: 'Blau' },
  { value: '#c0182b', label: 'Rot' },
]
