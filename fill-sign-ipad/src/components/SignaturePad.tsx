import { useEffect, useRef, useState } from 'react'
import type { SavedSignature } from '../types'

interface Props {
  role: 'signature' | 'initials'
  onDone: (sig: SavedSignature) => void
  onCancel: () => void
}

type Point = { x: number; y: number; w: number }

/** Full-width drawing surface for Apple Pencil or finger; Pencil pressure controls line width. */
export default function SignaturePad({ role, onDone, onCancel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const strokes = useRef<Point[][]>([])
  const [empty, setEmpty] = useState(true)

  useEffect(() => {
    const canvas = canvasRef.current!
    const dpr = window.devicePixelRatio || 1
    const resize = () => {
      const r = canvas.getBoundingClientRect()
      canvas.width = r.width * dpr
      canvas.height = r.height * dpr
      redraw()
    }
    const redraw = () => {
      const ctx = canvas.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (const s of strokes.current) drawStroke(ctx, s, 0)
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  const widthFor = (e: PointerEvent) => {
    const base = role === 'initials' ? 3.2 : 2.8
    if (e.pointerType === 'pen') return base * (0.35 + 1.3 * (e.pressure || 0.5))
    return base
  }

  const pointFrom = (e: PointerEvent): Point => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: widthFor(e) }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    canvasRef.current!.setPointerCapture(e.pointerId)
    strokes.current.push([pointFrom(e.nativeEvent)])
    setEmpty(false)
    const ctx = canvasRef.current!.getContext('2d')!
    drawStroke(ctx, strokes.current[strokes.current.length - 1], 0)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!canvasRef.current!.hasPointerCapture(e.pointerId)) return
    const stroke = strokes.current[strokes.current.length - 1]
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]
    const from = Math.max(0, stroke.length - 2)
    for (const ev of events.length ? events : [e.nativeEvent]) {
      const p = pointFrom(ev)
      const last = stroke[stroke.length - 1]
      // smooth width changes so pressure jitter doesn't show
      p.w = last.w * 0.7 + p.w * 0.3
      stroke.push(p)
    }
    drawStroke(canvasRef.current!.getContext('2d')!, stroke, from)
  }

  const clear = () => {
    strokes.current = []
    const c = canvasRef.current!
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
    setEmpty(true)
  }

  const finish = () => {
    const sig = trim(canvasRef.current!)
    if (sig) onDone(sig)
  }

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="sigpad">
        <div className="sigpad-head">
          <button className="btn-text" onClick={onCancel}>Abbrechen</button>
          <strong>{role === 'signature' ? 'Unterschrift erstellen' : 'Initialen erstellen'}</strong>
          <button className="btn-text strong" disabled={empty} onClick={finish}>Fertig</button>
        </div>
        <div className={`sigpad-area ${role}`}>
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
          />
          <div className="sigpad-line">
            <span>✕</span>
          </div>
          {empty && <div className="sigpad-hint">Hier mit Apple Pencil oder Finger {role === 'signature' ? 'unterschreiben' : 'Initialen zeichnen'}</div>}
        </div>
        <div className="sigpad-foot">
          <button className="btn-text" disabled={empty} onClick={clear}>Löschen</button>
        </div>
      </div>
    </div>
  )
}

function drawStroke(ctx: CanvasRenderingContext2D, pts: Point[], from: number) {
  ctx.strokeStyle = '#000'
  ctx.fillStyle = '#000'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (pts.length === 1) {
    ctx.beginPath()
    ctx.arc(pts[0].x, pts[0].y, pts[0].w / 2, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  // quadratic curves through segment midpoints, each segment with its own width
  for (let i = Math.max(1, from); i < pts.length; i++) {
    const p0 = pts[i - 2] ?? pts[i - 1]
    const p1 = pts[i - 1]
    const p2 = pts[i]
    const m0 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }
    const m1 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
    ctx.beginPath()
    ctx.lineWidth = (p1.w + p2.w) / 2
    ctx.moveTo(m0.x, m0.y)
    ctx.quadraticCurveTo(p1.x, p1.y, m1.x, m1.y)
    ctx.stroke()
  }
}

/** Crops the canvas to the drawn ink and returns it as PNG. */
function trim(canvas: HTMLCanvasElement): SavedSignature | null {
  const ctx = canvas.getContext('2d')!
  const { width, height } = canvas
  const data = ctx.getImageData(0, 0, width, height).data
  let x0 = width, y0 = height, x1 = -1, y1 = -1
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  if (x1 < 0) return null
  const pad = 6
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad)
  x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad)
  const out = document.createElement('canvas')
  out.width = x1 - x0 + 1
  out.height = y1 - y0 + 1
  out.getContext('2d')!.drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height)
  return { dataUrl: out.toDataURL('image/png'), w: out.width, h: out.height }
}
