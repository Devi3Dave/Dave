import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { Ann, DocMeta, PageSize, SavedSignature, Stamp, Tool } from '../types'
import { INK_COLORS } from '../types'
import { openPdf, pageSizes, type PDFDocumentProxy } from '../pdf'
import { exportPdf } from '../exportPdf'
import { putDoc } from '../db'
import { loadInk, loadSignature, saveInk, saveSignature, type SigRole } from '../settings'
import { clamp, formatDate, tintImage, uid } from '../util'
import PageView from './PageView'
import type { DragMode } from './AnnotationItem'
import SignaturePad from './SignaturePad'
import ProfileSheet from './ProfileSheet'
import * as I from './icons'

interface Props {
  meta: DocMeta
  bytes: ArrayBuffer
  onClose: () => void
}

const TOOLS: { tool: Tool; label: string; Icon: (p: React.SVGProps<SVGSVGElement>) => JSX.Element }[] = [
  { tool: 'text', label: 'Text', Icon: I.IconText },
  { tool: 'cross', label: 'Kreuz', Icon: I.IconCross },
  { tool: 'check', label: 'Häkchen', Icon: I.IconCheck },
  { tool: 'dot', label: 'Punkt', Icon: I.IconDot },
  { tool: 'rect', label: 'Rahmen', Icon: I.IconRect },
  { tool: 'line', label: 'Linie', Icon: I.IconLine },
]

const SHAPE_DEFAULTS = {
  check: { w: 14, h: 14 },
  cross: { w: 14, h: 14 },
  dot: { w: 8, h: 8 },
  rect: { w: 90, h: 28 },
  line: { w: 90, h: 12 },
}

const ZOOM_MIN = 0.5
const ZOOM_MAX = 5

interface DragState {
  id: string
  mode: DragMode
  pointerId: number
  startX: number
  startY: number
  orig: Ann
  origPxWidth: number
  moved: boolean
}

type Popover = 'signature' | 'profile' | null

const blurActive = () => {
  const el = document.activeElement as HTMLElement | null
  if (el && el !== document.body) el.blur()
}

export default function Editor({ meta, bytes, onClose }: Props) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [sizes, setSizes] = useState<PageSize[]>([])
  const [error, setError] = useState<string | null>(null)

  const [anns, setAnns] = useState<Ann[]>(meta.anns)
  const annsRef = useRef(anns)
  const past = useRef<Ann[][]>([])
  const future = useRef<Ann[][]>([])
  const [, setHistoryTick] = useState(0)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [tool, setTool] = useState<Tool>('text')
  const [stamp, setStamp] = useState<Stamp | null>(null)
  const [color, setColor] = useState(loadInk)
  const [fontSize, setFontSize] = useState(12)
  const [popover, setPopover] = useState<Popover>(null)
  const [popPos, setPopPos] = useState<React.CSSProperties>({})
  const [padRole, setPadRole] = useState<SigRole | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [readyFile, setReadyFile] = useState<File | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [viewW, setViewW] = useState(0)
  const [zoom, setZoom] = useState(1)
  const pendingScroll = useRef<{ left: number; top: number } | null>(null)
  const drag = useRef<DragState | null>(null)

  // ---------- load ----------
  useEffect(() => {
    let doc: PDFDocumentProxy | null = null
    openPdf(bytes)
      .then(async (d) => {
        doc = d
        setSizes(await pageSizes(d))
        setPdf(d)
      })
      .catch((e) => setError(e?.message || 'Dokument konnte nicht geöffnet werden.'))
    return () => void doc?.destroy()
  }, [bytes])

  useLayoutEffect(() => {
    const el = scrollRef.current!
    const ro = new ResizeObserver(() => setViewW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const maxPageW = Math.max(1, ...sizes.map((s) => s.w))
  const fitScale = viewW ? Math.max(0.2, (viewW - 40) / maxPageW) : 1
  const scale = fitScale * zoom

  // ---------- autosave ----------
  useEffect(() => {
    if (anns === meta.anns) return
    const t = setTimeout(() => {
      meta.anns = anns
      meta.updatedAt = Date.now()
      putDoc({ ...meta }).catch(() => setToast('Speichern fehlgeschlagen'))
    }, 500)
    return () => clearTimeout(t)
  }, [anns, meta])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  // ---------- history ----------
  const commit = useCallback((next: Ann[]) => {
    past.current.push(annsRef.current)
    if (past.current.length > 200) past.current.shift()
    future.current = []
    annsRef.current = next
    setAnns(next)
    setHistoryTick((t) => t + 1)
  }, [])

  /** Change without a new undo step (used while dragging, after a snapshot was pushed). */
  const live = useCallback((next: Ann[]) => {
    annsRef.current = next
    setAnns(next)
  }, [])

  const undo = () => {
    blurActive()
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(annsRef.current)
    annsRef.current = prev
    setAnns(prev)
    setSelectedId(null)
    setHistoryTick((t) => t + 1)
  }

  const redo = () => {
    blurActive()
    const next = future.current.pop()
    if (!next) return
    past.current.push(annsRef.current)
    annsRef.current = next
    setAnns(next)
    setSelectedId(null)
    setHistoryTick((t) => t + 1)
  }

  const updateAnn = (id: string, patch: Partial<Ann>, record = true) => {
    const next = annsRef.current.map((a) => (a.id === id ? ({ ...a, ...patch } as Ann) : a))
    record ? commit(next) : live(next)
  }

  const removeAnn = (id: string) => {
    commit(annsRef.current.filter((a) => a.id !== id))
    setSelectedId(null)
    setEditingId(null)
  }

  // ---------- placing ----------
  const startEditing = (id: string) => {
    // flushSync keeps focus() inside the user gesture so iPadOS shows the keyboard
    flushSync(() => {
      setSelectedId(id)
      setEditingId(id)
    })
  }

  const addText = (page: number, x: number, y: number, text: string) => {
    const size = sizes[page]
    const ann: Ann = {
      id: uid(), kind: 'text', page, text, fontSize, color,
      x: clamp(x, 0, size.w - 10),
      y: clamp(y - fontSize * 0.6, 0, size.h - fontSize),
    }
    flushSync(() => commit([...annsRef.current, ann]))
    if (text) setSelectedId(ann.id)
    else startEditing(ann.id)
  }

  const addImage = async (page: number, cx: number, cy: number, role: SigRole, sig: SavedSignature) => {
    const size = sizes[page]
    let h = role === 'signature' ? 36 : 26
    let w = (h * sig.w) / sig.h
    if (w > size.w * 0.6) {
      w = size.w * 0.6
      h = (w * sig.h) / sig.w
    }
    const src = await tintImage(sig.dataUrl, color)
    const ann: Ann = {
      id: uid(), kind: 'image', role, page, src, color, w, h,
      x: clamp(cx - w / 2, 0, size.w - w),
      y: clamp(cy - h / 2, 0, size.h - h),
    }
    commit([...annsRef.current, ann])
    setSelectedId(ann.id)
  }

  const onTap = (page: number, x: number, y: number) => {
    setPopover(null)
    if (editingId) {
      blurActive()
      setSelectedId(null)
      return
    }
    if (selectedId && !stamp) {
      setSelectedId(null)
      return
    }
    if (stamp) {
      setStamp(null)
      if (stamp.kind === 'text') addText(page, x, y, stamp.text)
      else void addImage(page, x, y, stamp.role, stamp.sig)
      return
    }
    if (tool === 'text') {
      addText(page, x, y, '')
      return
    }
    const size = sizes[page]
    const d = SHAPE_DEFAULTS[tool]
    const ann: Ann = {
      id: uid(), kind: tool, page, color, w: d.w, h: d.h,
      x: clamp(x - d.w / 2, 0, size.w - d.w),
      y: clamp(y - d.h / 2, 0, size.h - d.h),
    }
    commit([...annsRef.current, ann])
  }

  const onCommitText = (id: string, text: string) => {
    const ann = annsRef.current.find((a) => a.id === id)
    setEditingId(null)
    if (!ann || ann.kind !== 'text') return
    if (!text.trim()) {
      // An abandoned new field leaves no trace in the undo history.
      const top = past.current[past.current.length - 1]
      if (!ann.text && top && !top.some((a) => a.id === id)) {
        past.current.pop()
        live(annsRef.current.filter((a) => a.id !== id))
        setHistoryTick((t) => t + 1)
      } else {
        commit(annsRef.current.filter((a) => a.id !== id))
      }
      setSelectedId(null)
      return
    }
    if (text !== ann.text) updateAnn(id, { text })
  }

  // ---------- dragging / resizing ----------
  const onAnnPointerDown = (e: React.PointerEvent, ann: Ann, mode: DragMode) => {
    e.stopPropagation()
    setPopover(null)
    if (editingId === ann.id && mode === 'move') return // let the caret move inside the text
    if (editingId) blurActive()
    if (stamp) setStamp(null)
    const box = (e.currentTarget as HTMLElement).closest('.ann')!.getBoundingClientRect()
    drag.current = {
      id: ann.id, mode, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY,
      orig: ann, origPxWidth: box.width, moved: false,
    }
    setSelectedId(ann.id)
  }

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current
      if (!d || e.pointerId !== d.pointerId) return
      const dxPx = e.clientX - d.startX
      const dyPx = e.clientY - d.startY
      if (!d.moved) {
        if (Math.hypot(dxPx, dyPx) < 4) return
        d.moved = true
        past.current.push(annsRef.current)
        future.current = []
        setHistoryTick((t) => t + 1)
      }
      const dx = dxPx / scale
      const dy = dyPx / scale
      const o = d.orig
      const page = sizes[o.page]
      if (d.mode === 'move') {
        const w = o.kind === 'text' ? d.origPxWidth / scale : o.w
        const h = o.kind === 'text' ? o.fontSize : o.h
        updateAnn(o.id, { x: clamp(o.x + dx, -w * 0.5, page.w - w * 0.5), y: clamp(o.y + dy, 0, page.h - h) }, false)
        return
      }
      switch (o.kind) {
        case 'text': {
          const f = (d.origPxWidth + dxPx) / Math.max(1, d.origPxWidth)
          const fs = clamp(o.fontSize * f, 4, 144)
          updateAnn(o.id, { fontSize: fs }, false)
          setFontSize(Math.round(fs))
          break
        }
        case 'image': {
          const w = clamp(o.w + dx, 12, page.w)
          updateAnn(o.id, { w, h: (w * o.h) / o.w }, false)
          break
        }
        case 'rect':
          updateAnn(o.id, { w: Math.max(8, o.w + dx), h: Math.max(8, o.h + dy) }, false)
          break
        case 'line':
          updateAnn(o.id, { w: Math.max(8, o.w + dx) }, false)
          break
        default: {
          const s = clamp(o.w + Math.max(dx, dy), 4, 200)
          updateAnn(o.id, { w: s, h: s }, false)
        }
      }
    }
    const up = (e: PointerEvent) => {
      const d = drag.current
      if (!d || e.pointerId !== d.pointerId) return
      drag.current = null
      if (!d.moved && d.mode === 'move' && d.orig.kind === 'text') startEditing(d.id)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  })

  // ---------- zoom (pinch on iPad, ctrl+wheel on desktop) ----------
  const applyZoom = useCallback((factor: number, focusX?: number, focusY?: number) => {
    const el = scrollRef.current!
    setZoom((z) => {
      const nz = clamp(z * factor, ZOOM_MIN, ZOOM_MAX)
      const ratio = nz / z
      const fx = focusX ?? el.clientWidth / 2
      const fy = focusY ?? el.clientHeight / 2
      pendingScroll.current = {
        left: (el.scrollLeft + fx) * ratio - fx,
        top: (el.scrollTop + fy) * ratio - fy,
      }
      return nz
    })
  }, [])

  useLayoutEffect(() => {
    const p = pendingScroll.current
    if (!p) return
    pendingScroll.current = null
    scrollRef.current!.scrollTo(p.left, p.top)
  }, [zoom])

  useEffect(() => {
    const el = scrollRef.current!
    const inner = innerRef.current!
    let focus = { x: 0, y: 0 }
    type GestureEvent = Event & { scale: number; clientX: number; clientY: number }
    const start = (e: Event) => {
      e.preventDefault()
      const g = e as GestureEvent
      const r = el.getBoundingClientRect()
      focus = { x: g.clientX - r.left, y: g.clientY - r.top }
      inner.style.transformOrigin = `${el.scrollLeft + focus.x}px ${el.scrollTop + focus.y}px`
    }
    const change = (e: Event) => {
      e.preventDefault()
      inner.style.transform = `scale(${(e as GestureEvent).scale})`
    }
    const end = (e: Event) => {
      e.preventDefault()
      inner.style.transform = ''
      applyZoom((e as GestureEvent).scale, focus.x, focus.y)
    }
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      applyZoom(Math.exp(-e.deltaY / 200), e.clientX - r.left, e.clientY - r.top)
    }
    el.addEventListener('gesturestart', start)
    el.addEventListener('gesturechange', change)
    el.addEventListener('gestureend', end)
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      el.removeEventListener('gesturestart', start)
      el.removeEventListener('gesturechange', change)
      el.removeEventListener('gestureend', end)
      el.removeEventListener('wheel', wheel)
    }
  }, [applyZoom])

  // ---------- keyboard (hardware keyboard / Magic Keyboard) ----------
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (editingId || padRole) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        e.shiftKey ? redo() : undo()
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && selectedId) {
        e.preventDefault()
        removeAnn(selectedId)
      } else if (e.key === 'Escape') {
        setSelectedId(null)
        setStamp(null)
        setPopover(null)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  // ---------- toolbar actions ----------
  const pickColor = async (c: string) => {
    setColor(c)
    saveInk(c)
    const sel = annsRef.current.find((a) => a.id === selectedId)
    if (!sel) return
    if (sel.kind === 'image') updateAnn(sel.id, { color: c, src: await tintImage(sel.src, c) })
    else updateAnn(sel.id, { color: c })
  }

  const changeFont = (delta: number) => {
    const sel = annsRef.current.find((a) => a.id === selectedId)
    if (!sel || sel.kind !== 'text') return
    const fs = clamp(Math.round(sel.fontSize + delta), 4, 144)
    setFontSize(fs)
    updateAnn(sel.id, { fontSize: fs })
  }

  const chooseStamp = (s: Stamp) => {
    blurActive()
    setSelectedId(null)
    setPopover(null)
    setStamp(s)
  }

  const share = async () => {
    blurActive()
    setSelectedId(null)
    setBusy(true)
    let file: File
    try {
      const out = await exportPdf(bytes, annsRef.current)
      file = new File([out], `${meta.name}.pdf`, { type: 'application/pdf' })
    } catch (e) {
      setBusy(false)
      setToast('Export fehlgeschlagen: ' + ((e as Error)?.message ?? e))
      return
    }
    setBusy(false)
    await deliver(file)
  }

  const deliver = async (file: File) => {
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: meta.name })
        setReadyFile(null)
      } catch (e) {
        // Safari drops the user gesture if the export took too long – ask for a second tap.
        if ((e as DOMException).name === 'NotAllowedError') setReadyFile(file)
      }
      return
    }
    download(file)
    setReadyFile(null)
  }

  const download = (file: File) => {
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  const close = async () => {
    blurActive()
    meta.anns = annsRef.current
    meta.updatedAt = Date.now()
    await putDoc({ ...meta }).catch(() => undefined)
    onClose()
  }

  const selected = anns.find((a) => a.id === selectedId) ?? null

  // context bar shown next to the selected annotation
  const contextBar = selected && !drag.current?.moved && (
    <div
      className="context-bar"
      style={{
        left: Math.max(0, selected.x * scale),
        top: selected.y * scale > 52 ? selected.y * scale - 48 : selected.y * scale + (selected.kind === 'text' ? selected.fontSize * 1.3 : selected.h) * scale + 8,
      }}
      onPointerDown={(e) => {
        e.stopPropagation()
        e.preventDefault() // keep the keyboard open while editing text
      }}
    >
      {selected.kind === 'text' && (
        <>
          <button onClick={() => changeFont(-1)} aria-label="Kleiner"><span className="small-a">A</span></button>
          <span className="font-size">{Math.round(selected.fontSize)}</span>
          <button onClick={() => changeFont(1)} aria-label="Größer"><span className="big-a">A</span></button>
          <span className="sep" />
        </>
      )}
      <button onClick={() => removeAnn(selected.id)} aria-label="Löschen" className="danger"><I.IconTrash width={20} height={20} /></button>
    </div>
  )

  const sigFor = (role: SigRole) => loadSignature(role)

  // The toolbar scrolls horizontally, so popovers are fixed-positioned below their button.
  const togglePopover = (kind: Exclude<Popover, null>, e: React.MouseEvent) => {
    blurActive()
    if (popover === kind) return setPopover(null)
    const r = e.currentTarget.getBoundingClientRect()
    const width = Math.min(kind === 'profile' ? 360 : 320, window.innerWidth - 24)
    setPopPos({ top: r.bottom + 8, left: clamp(r.left + r.width / 2 - width / 2, 12, window.innerWidth - width - 12), width })
    setPopover(kind)
  }

  return (
    <div className="editor">
      <header className="topbar">
        <button className="btn-text back" onClick={close}><I.IconBack /> Dokumente</button>
        <div className="title" title={meta.name}>{meta.name}</div>
        <div className="topbar-actions">
          <button className="icon-btn" onClick={undo} disabled={!past.current.length} aria-label="Rückgängig"><I.IconUndo /></button>
          <button className="icon-btn" onClick={redo} disabled={!future.current.length} aria-label="Wiederholen"><I.IconRedo /></button>
          <button className="btn-primary" onClick={share} disabled={busy || !pdf}>
            <I.IconShare width={20} height={20} /> {busy ? 'Exportiere…' : 'Teilen'}
          </button>
        </div>
      </header>

      <nav className="toolbar">
        <div className="tool-group">
          {TOOLS.map(({ tool: t, label, Icon }) => (
            <button
              key={t}
              className={`tool${tool === t && !stamp ? ' active' : ''}`}
              onClick={() => { blurActive(); setStamp(null); setTool(t); setSelectedId(null) }}
              aria-label={label}
              title={label}
            >
              <Icon />
            </button>
          ))}
        </div>
        <span className="sep" />
        <div className="tool-group">
          <button className="tool" title="Datum" aria-label="Datum" onClick={() => chooseStamp({ kind: 'text', text: formatDate() })}>
            <I.IconCalendar />
          </button>
          <div className="anchor">
            <button className={`tool${popover === 'signature' ? ' active' : ''}`} title="Unterschreiben" aria-label="Unterschreiben"
              onClick={(e) => togglePopover('signature', e)}>
              <I.IconPen />
            </button>
            {popover === 'signature' && (
              <div className="popover sig-menu" style={popPos}>
                {(['signature', 'initials'] as const).map((role) => {
                  const sig = sigFor(role)
                  const label = role === 'signature' ? 'Unterschrift' : 'Initialen'
                  return sig ? (
                    <div className="sig-row" key={role}>
                      <button className="sig-preview" onClick={() => chooseStamp({ kind: 'image', role, sig })} aria-label={`${label} einfügen`}>
                        <img src={sig.dataUrl} alt={label} />
                      </button>
                      <button className="icon-btn" aria-label={`${label} löschen`} onClick={() => { saveSignature(role, null); setPopover(null) }}>
                        <I.IconTrash width={20} height={20} />
                      </button>
                    </div>
                  ) : (
                    <button key={role} className="sig-create" onClick={() => { setPopover(null); setPadRole(role) }}>
                      <I.IconPlus width={18} height={18} /> {label} erstellen
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          <div className="anchor">
            <button className={`tool${popover === 'profile' ? ' active' : ''}`} title="Eigene Angaben" aria-label="Eigene Angaben"
              onClick={(e) => togglePopover('profile', e)}>
              <I.IconPerson />
            </button>
            {popover === 'profile' && (
              <ProfileSheet style={popPos} onPick={(text) => chooseStamp({ kind: 'text', text })} onClose={() => setPopover(null)} />
            )}
          </div>
        </div>
        <span className="sep" />
        <div className="tool-group colors">
          {INK_COLORS.map((c) => (
            <button
              key={c.value}
              className={`swatch${color === c.value ? ' active' : ''}`}
              style={{ background: c.value }}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => void pickColor(c.value)}
              aria-label={c.label}
              title={c.label}
            />
          ))}
        </div>
        <span className="spacer" />
        <div className="tool-group zoom">
          <button className="tool" aria-label="Verkleinern" onClick={() => applyZoom(1 / 1.25)}><I.IconZoomOut /></button>
          <button className="zoom-label" onClick={() => applyZoom(1 / zoom)} title="Seitenbreite">{Math.round(zoom * 100)}%</button>
          <button className="tool" aria-label="Vergrößern" onClick={() => applyZoom(1.25)}><I.IconZoomIn /></button>
        </div>
      </nav>

      {stamp && (
        <div className="banner">
          Tippe auf die Stelle, an der {stamp.kind === 'image' ? (stamp.role === 'signature' ? 'die Unterschrift' : 'die Initialen') : `„${stamp.text}“`} eingefügt werden soll.
          <button className="btn-text" onClick={() => setStamp(null)}>Abbrechen</button>
        </div>
      )}

      <div className="scroller" ref={scrollRef} onPointerDown={(e) => e.target === e.currentTarget && setSelectedId(null)}>
        <div className="pages" ref={innerRef}>
          {error && <div className="empty-state">{error}</div>}
          {!pdf && !error && <div className="spinner" />}
          {pdf && sizes.map((size, i) => (
            <PageView
              key={i}
              pdf={pdf}
              index={i}
              size={size}
              scale={scale}
              anns={anns.filter((a) => a.page === i)}
              selectedId={selectedId}
              editingId={editingId}
              overlay={selected?.page === i ? contextBar : null}
              onTap={onTap}
              onAnnPointerDown={onAnnPointerDown}
              onCommitText={onCommitText}
            />
          ))}
        </div>
      </div>

      {padRole && (
        <SignaturePad
          role={padRole}
          onCancel={() => setPadRole(null)}
          onDone={(sig) => {
            saveSignature(padRole, sig)
            setPadRole(null)
            chooseStamp({ kind: 'image', role: padRole, sig })
          }}
        />
      )}

      {readyFile && (
        <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setReadyFile(null)}>
          <div className="dialog">
            <strong>PDF ist fertig</strong>
            <p className="muted">{readyFile.name}</p>
            <div className="dialog-actions">
              <button className="btn-text" onClick={() => { download(readyFile); setReadyFile(null) }}>Sichern</button>
              <button className="btn-primary" onClick={() => void deliver(readyFile)}><I.IconShare width={20} height={20} /> Teilen</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
