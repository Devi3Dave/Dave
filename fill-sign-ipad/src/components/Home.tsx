import { useEffect, useRef, useState } from 'react'
import type { DocMeta } from '../types'
import { deleteDoc, listDocs, putDoc } from '../db'
import * as I from './icons'

interface Props {
  onOpen: (doc: DocMeta) => void
  onImport: (file: File) => Promise<void>
}

export default function Home({ onOpen, onImport }: Props) {
  const [docs, setDocs] = useState<DocMeta[] | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  const refresh = () => listDocs().then(setDocs).catch(() => setDocs([]))
  useEffect(() => void refresh(), [])

  const handleFiles = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      await onImport(file)
    } catch (e) {
      setError((e as Error)?.message || 'Datei konnte nicht geöffnet werden.')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
      if (cameraRef.current) cameraRef.current.value = ''
    }
  }

  const rename = async (doc: DocMeta) => {
    setMenu(null)
    const name = window.prompt('Neuer Name', doc.name)?.trim()
    if (!name || name === doc.name) return
    await putDoc({ ...doc, name, updatedAt: Date.now() })
    refresh()
  }

  const remove = async (doc: DocMeta) => {
    setMenu(null)
    if (!window.confirm(`„${doc.name}“ wirklich löschen?`)) return
    await deleteDoc(doc.id)
    refresh()
  }

  return (
    <div
      className={`home${dragOver ? ' drag-over' : ''}`}
      onPointerDown={(e) => !(e.target as HTMLElement).closest('.card-menu, .more') && setMenu(null)}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); void handleFiles(e.dataTransfer.files) }}
    >
      <header className="home-head">
        <h1>Ausfüllen &amp; Signieren</h1>
        <p className="muted">Formulare ausfüllen und unterschreiben – direkt auf dem iPad.</p>
      </header>

      <div className="actions">
        <button className="action" onClick={() => fileRef.current?.click()} disabled={busy}>
          <span className="action-icon"><I.IconDoc /></span>
          <span>
            <strong>Formular auswählen</strong>
            <small>PDF oder Bild aus „Dateien“ oder „Fotos“</small>
          </span>
        </button>
        <button className="action" onClick={() => cameraRef.current?.click()} disabled={busy}>
          <span className="action-icon"><I.IconCamera /></span>
          <span>
            <strong>Papierformular fotografieren</strong>
            <small>Mit der Kamera aufnehmen</small>
          </span>
        </button>
        <input ref={fileRef} type="file" accept="application/pdf,.pdf,image/*" hidden onChange={(e) => void handleFiles(e.target.files)} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void handleFiles(e.target.files)} />
      </div>

      {busy && <div className="banner">Dokument wird geöffnet…</div>}
      {error && <div className="banner error">{error}</div>}

      <h2>Zuletzt bearbeitet</h2>
      {docs === null ? (
        <div className="spinner" />
      ) : docs.length === 0 ? (
        <div className="empty-state">
          Noch keine Dokumente. Wähle ein Formular aus oder fotografiere eines.
          <br />
          <span className="muted">Tipp: Du kannst PDFs auch aus einer anderen App hierher ziehen.</span>
        </div>
      ) : (
        <div className="grid">
          {docs.map((d) => (
            <div className="card" key={d.id}>
              <button className="card-thumb" onClick={() => onOpen(d)}>
                <img src={d.thumb} alt="" />
                {d.anns.length > 0 && <span className="badge">ausgefüllt</span>}
              </button>
              <div className="card-info">
                <div>
                  <div className="card-name">{d.name}</div>
                  <div className="muted small">
                    {new Date(d.updatedAt).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' })}
                    {' · '}{d.pageCount} {d.pageCount === 1 ? 'Seite' : 'Seiten'}
                  </div>
                </div>
                <button className="icon-btn more" aria-label="Mehr" onClick={() => setMenu(menu === d.id ? null : d.id)}>
                  <I.IconMore />
                </button>
                {menu === d.id && (
                  <div className="popover card-menu">
                    <button onClick={() => void rename(d)}>Umbenennen</button>
                    <button className="danger" onClick={() => void remove(d)}>Löschen</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <footer className="home-foot muted small">
        Alle Dokumente und Unterschriften bleiben ausschließlich auf diesem Gerät gespeichert.
      </footer>
    </div>
  )
}
