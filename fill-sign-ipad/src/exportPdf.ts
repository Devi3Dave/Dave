import { PDFDocument, PDFFont, PDFPage, StandardFonts, LineCapStyle, degrees, rgb } from 'pdf-lib'
import type { Ann, ShapeAnn } from './types'
import { dataUrlToBytes } from './util'

/** Baseline position of the first line relative to the text box top, as fraction of font size. */
export const BASELINE = 0.88
export const LINE_HEIGHT = 1.2
export const LINE_STROKE = 1.5

type Pt = [number, number]

const hex = (c: string) => {
  const n = parseInt(c.slice(1), 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

/** Maps a point of the displayed (rotated) page, top-left origin, into PDF user space. */
function mapper(page: PDFPage) {
  const box = page.getCropBox()
  const rot = ((page.getRotation().angle % 360) + 360) % 360
  const { width: w, height: h } = box
  return {
    rot,
    pt([x, y]: Pt): { x: number; y: number } {
      let X: number, Y: number
      switch (rot) {
        case 90: X = y; Y = x; break
        case 180: X = w - x; Y = y; break
        case 270: X = w - y; Y = h - x; break
        default: X = x; Y = h - y
      }
      return { x: X + box.x, y: Y + box.y }
    },
  }
}

/** Unit-square polylines used for both on-screen SVG and PDF export. */
export const SHAPE_PATHS: Record<'check' | 'cross', Pt[][]> = {
  check: [[[0.1, 0.55], [0.38, 0.82], [0.9, 0.18]]],
  cross: [[[0.15, 0.15], [0.85, 0.85]], [[0.85, 0.15], [0.15, 0.85]]],
}

export const shapeStroke = (a: ShapeAnn) => (a.kind === 'line' || a.kind === 'rect' ? LINE_STROKE : a.w * 0.12)

function encodable(font: PDFFont, text: string) {
  const set = new Set(font.getCharacterSet())
  return [...text].map((ch) => (set.has(ch.codePointAt(0)!) ? ch : '?')).join('')
}

export async function exportPdf(original: ArrayBuffer, anns: Ann[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(original, { ignoreEncryption: true })
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const pages = pdf.getPages()
  const images = new Map<string, Awaited<ReturnType<PDFDocument['embedPng']>>>()

  for (const a of anns) {
    const page = pages[a.page]
    if (!page) continue
    const m = mapper(page)
    const color = hex(a.color)
    const line = (p: Pt, q: Pt, thickness: number) =>
      page.drawLine({ start: m.pt(p), end: m.pt(q), thickness, color, lineCap: LineCapStyle.Round })

    switch (a.kind) {
      case 'text': {
        a.text.split('\n').forEach((ln, i) => {
          if (!ln) return
          const at = m.pt([a.x, a.y + a.fontSize * (BASELINE + i * LINE_HEIGHT)])
          page.drawText(encodable(font, ln), { ...at, size: a.fontSize, font, color, rotate: degrees(m.rot) })
        })
        break
      }
      case 'image': {
        let img = images.get(a.src)
        if (!img) {
          img = await pdf.embedPng(dataUrlToBytes(a.src))
          images.set(a.src, img)
        }
        const at = m.pt([a.x, a.y + a.h])
        page.drawImage(img, { ...at, width: a.w, height: a.h, rotate: degrees(m.rot) })
        break
      }
      case 'dot': {
        const c = m.pt([a.x + a.w / 2, a.y + a.h / 2])
        page.drawEllipse({ ...c, xScale: a.w / 2, yScale: a.h / 2, color })
        break
      }
      case 'line': {
        const y = a.y + a.h / 2
        line([a.x, y], [a.x + a.w, y], LINE_STROKE)
        break
      }
      case 'rect': {
        const s = LINE_STROKE / 2
        const corners: Pt[] = [[a.x + s, a.y + s], [a.x + a.w - s, a.y + s], [a.x + a.w - s, a.y + a.h - s], [a.x + s, a.y + a.h - s]]
        corners.forEach((p, i) => line(p, corners[(i + 1) % 4], LINE_STROKE))
        break
      }
      case 'check':
      case 'cross': {
        const map = ([u, v]: Pt): Pt => [a.x + u * a.w, a.y + v * a.h]
        for (const poly of SHAPE_PATHS[a.kind])
          for (let i = 1; i < poly.length; i++) line(map(poly[i - 1]), map(poly[i]), shapeStroke(a))
        break
      }
    }
  }
  return pdf.save()
}
