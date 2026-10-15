import { useEffect, useRef, useState } from 'react'
import type { Ann, PageSize } from '../types'
import type { PDFDocumentProxy } from '../pdf'
import AnnotationItem, { type DragMode } from './AnnotationItem'

interface Props {
  pdf: PDFDocumentProxy
  index: number
  size: PageSize
  scale: number
  anns: Ann[]
  selectedId: string | null
  editingId: string | null
  overlay?: React.ReactNode
  onTap: (page: number, x: number, y: number) => void
  onAnnPointerDown: (e: React.PointerEvent, ann: Ann, mode: DragMode) => void
  onCommitText: (id: string, text: string) => void
}

// iPad Safari kills the tab when canvases use too much memory, so cap pixels per page.
const MAX_CANVAS_PIXELS = 10_000_000

export default function PageView(props: Props) {
  const { pdf, index, size, scale, anns } = props
  const wrapRef = useRef<HTMLDivElement>(null)
  const holderRef = useRef<HTMLDivElement>(null)
  const tap = useRef<{ x: number; y: number; t: number; id: number } | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '150% 0px' })
    io.observe(wrapRef.current!)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const holder = holderRef.current!
    const release = () => {
      holder.querySelectorAll('canvas').forEach((c) => { c.width = 0; c.height = 0 })
      holder.replaceChildren()
    }
    if (!visible) {
      release()
      return
    }
    let cancelled = false
    let task: { cancel: () => void } | null = null
    const timer = setTimeout(async () => {
      const page = await pdf.getPage(index + 1)
      if (cancelled) return
      const cssW = size.w * scale
      const cssH = size.h * scale
      const ratio = Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_CANVAS_PIXELS / (cssW * cssH)))
      const vp = page.getViewport({ scale: scale * ratio })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(vp.width)
      canvas.height = Math.floor(vp.height)
      const render = page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp })
      task = render
      try {
        await render.promise
      } catch {
        canvas.width = 0
        return // cancelled
      }
      if (cancelled) return
      release()
      holder.appendChild(canvas) // swap only when finished so zooming never flashes white
    }, 60)
    return () => {
      cancelled = true
      clearTimeout(timer)
      task?.cancel()
    }
  }, [visible, scale, pdf, index, size.w, size.h])

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget) return
    tap.current = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const t = tap.current
    tap.current = null
    if (!t || t.id !== e.pointerId) return
    if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > 10 || Date.now() - t.t > 700) return
    const r = e.currentTarget.getBoundingClientRect()
    props.onTap(index, (e.clientX - r.left) / scale, (e.clientY - r.top) / scale)
  }

  return (
    <div className="page" ref={wrapRef} style={{ width: size.w * scale, height: size.h * scale }}>
      <div className="page-canvas" ref={holderRef} />
      <div
        className="page-layer"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (tap.current = null)}
      >
        {anns.map((a) => (
          <AnnotationItem
            key={a.id}
            ann={a}
            scale={scale}
            selected={props.selectedId === a.id}
            editing={props.editingId === a.id}
            onPointerDown={props.onAnnPointerDown}
            onCommitText={props.onCommitText}
          />
        ))}
        {props.overlay}
      </div>
      <div className="page-number">{index + 1}</div>
    </div>
  )
}
