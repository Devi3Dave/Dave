// The legacy build ships polyfills, so it also runs on older iPadOS Safari versions.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PageSize } from './types'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export type { PDFDocumentProxy }

export function openPdf(bytes: ArrayBuffer): Promise<PDFDocumentProxy> {
  // pdf.js transfers (detaches) the buffer it is given, so always hand it a copy.
  return pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise
}

export async function pageSizes(doc: PDFDocumentProxy): Promise<PageSize[]> {
  const out: PageSize[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const vp = (await doc.getPage(i)).getViewport({ scale: 1 })
    out.push({ w: vp.width, h: vp.height })
  }
  return out
}

export async function renderThumb(doc: PDFDocumentProxy, width = 320): Promise<string> {
  const page = await doc.getPage(1)
  const vp1 = page.getViewport({ scale: 1 })
  const vp = page.getViewport({ scale: width / vp1.width })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(vp.width)
  canvas.height = Math.round(vp.height)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport: vp }).promise
  return canvas.toDataURL('image/jpeg', 0.8)
}
