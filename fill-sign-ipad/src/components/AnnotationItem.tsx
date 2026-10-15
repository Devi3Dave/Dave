import { useLayoutEffect, useRef } from 'react'
import type { Ann } from '../types'
import { LINE_HEIGHT, SHAPE_PATHS, shapeStroke } from '../exportPdf'

export type DragMode = 'move' | 'resize'

interface Props {
  ann: Ann
  scale: number
  selected: boolean
  editing: boolean
  onPointerDown: (e: React.PointerEvent, ann: Ann, mode: DragMode) => void
  onCommitText: (id: string, text: string) => void
}

export default function AnnotationItem({ ann, scale, selected, editing, onPointerDown, onCommitText }: Props) {
  const textRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!editing || ann.kind !== 'text') return
    const el = textRef.current!
    el.innerText = ann.text
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    // only when editing starts; later prop changes (e.g. font size) must not reset the caret
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  const style: React.CSSProperties = { left: ann.x * scale, top: ann.y * scale, color: ann.color }
  const cls = `ann ann-${ann.kind}${selected ? ' selected' : ''}${editing ? ' editing' : ''}`
  const handle = selected && !editing && (
    <div className="ann-handle" onPointerDown={(e) => onPointerDown(e, ann, 'resize')} />
  )

  if (ann.kind === 'text') {
    return (
      <div className={cls} style={style} data-ann={ann.id} onPointerDown={(e) => onPointerDown(e, ann, 'move')}>
        <div
          key={editing ? 'edit' : 'view'}
          ref={textRef}
          className="ann-textbox"
          style={{ fontSize: ann.fontSize * scale, lineHeight: LINE_HEIGHT }}
          contentEditable={editing ? 'plaintext-only' : false}
          suppressContentEditableWarning
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          onBlur={(e) => editing && onCommitText(ann.id, e.currentTarget.innerText.replace(/\n+$/, ''))}
          onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
        >
          {editing ? undefined : ann.text || '​'}
        </div>
        {handle}
      </div>
    )
  }

  const w = ann.w * scale
  const h = ann.h * scale
  let body: React.ReactNode
  if (ann.kind === 'image') {
    body = <img src={ann.src} width={w} height={h} alt="" draggable={false} />
  } else if (ann.kind === 'dot') {
    body = <svg width={w} height={h} viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="currentColor" /></svg>
  } else if (ann.kind === 'line') {
    body = (
      <svg width={w} height={h}>
        <line x1={0} x2={w} y1={h / 2} y2={h / 2} stroke="currentColor" strokeWidth={shapeStroke(ann) * scale} strokeLinecap="round" />
      </svg>
    )
  } else if (ann.kind === 'rect') {
    const s = shapeStroke(ann) * scale
    body = (
      <svg width={w} height={h}>
        <rect x={s / 2} y={s / 2} width={Math.max(0, w - s)} height={Math.max(0, h - s)} fill="none" stroke="currentColor" strokeWidth={s} strokeLinejoin="round" />
      </svg>
    )
  } else {
    const d = SHAPE_PATHS[ann.kind].map((poly) => 'M' + poly.map(([u, v]) => `${u * 100} ${v * 100}`).join(' L')).join(' ')
    body = (
      <svg width={w} height={h} viewBox="0 0 100 100">
        <path d={d} fill="none" stroke="currentColor" strokeWidth={(shapeStroke(ann) / ann.w) * 100} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }

  return (
    <div className={cls} style={{ ...style, width: w, height: h }} data-ann={ann.id} onPointerDown={(e) => onPointerDown(e, ann, 'move')}>
      {body}
      {handle}
    </div>
  )
}
