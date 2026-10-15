import { useState } from 'react'
import type { DocMeta } from './types'
import { getFile, putDoc, putFile } from './db'
import { fileToPdf } from './importFile'
import { openPdf, renderThumb } from './pdf'
import { uid } from './util'
import Home from './components/Home'
import Editor from './components/Editor'

type View = { kind: 'home' } | { kind: 'editor'; meta: DocMeta; bytes: ArrayBuffer }

export default function App() {
  const [view, setView] = useState<View>({ kind: 'home' })
  const [error, setError] = useState<string | null>(null)

  const open = async (meta: DocMeta) => {
    const bytes = await getFile(meta.id)
    if (!bytes) {
      setError('Die Datei dieses Dokuments fehlt.')
      return
    }
    setView({ kind: 'editor', meta, bytes })
  }

  const importFile = async (file: File) => {
    const { name, bytes } = await fileToPdf(file)
    const pdf = await openPdf(bytes)
    let meta: DocMeta
    try {
      meta = {
        id: uid(), name, pageCount: pdf.numPages, thumb: await renderThumb(pdf),
        anns: [], createdAt: Date.now(), updatedAt: Date.now(),
      }
    } finally {
      void pdf.destroy()
    }
    await putFile(meta.id, bytes)
    await putDoc(meta)
    setView({ kind: 'editor', meta, bytes })
  }

  if (view.kind === 'editor')
    return <Editor key={view.meta.id} meta={view.meta} bytes={view.bytes} onClose={() => setView({ kind: 'home' })} />

  return (
    <>
      <Home onOpen={(m) => void open(m)} onImport={importFile} />
      {error && <div className="toast" onClick={() => setError(null)}>{error}</div>}
    </>
  )
}
