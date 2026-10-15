import { PDFDocument } from 'pdf-lib'
import { loadImage } from './util'

const A4_LONG = 841.89
const A4_SHORT = 595.28
const MAX_PIXELS = 2600

export const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)

/** Accepts a PDF or a photo/scan and always returns PDF bytes. */
export async function fileToPdf(file: File): Promise<{ name: string; bytes: ArrayBuffer }> {
  const name = file.name.replace(/\.[^.]+$/, '') || 'Dokument'
  if (isPdf(file)) return { name, bytes: await file.arrayBuffer() }
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|heic|heif|webp|gif)$/i.test(file.name))
    throw new Error('Nur PDF-Dateien und Bilder werden unterstützt.')
  return { name: name === 'image' ? `Scan ${new Date().toLocaleDateString('de-DE')}` : name, bytes: await imageToPdf(file) }
}

async function decode(file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  try {
    return await createImageBitmap(file) // honours EXIF orientation
  } catch {
    const url = URL.createObjectURL(file)
    try {
      return await loadImage(url)
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

async function imageToPdf(file: File): Promise<ArrayBuffer> {
  const img = await decode(file)
  const scale = Math.min(1, MAX_PIXELS / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('Bild konnte nicht konvertiert werden'))), 'image/jpeg', 0.88),
  )

  // Fit the photo onto an A4-sized page in its own orientation.
  const landscape = canvas.width > canvas.height
  const boxW = landscape ? A4_LONG : A4_SHORT
  const boxH = landscape ? A4_SHORT : A4_LONG
  const s = Math.min(boxW / canvas.width, boxH / canvas.height)
  const w = canvas.width * s
  const h = canvas.height * s

  const pdf = await PDFDocument.create()
  const jpg = await pdf.embedJpg(await blob.arrayBuffer())
  pdf.addPage([w, h]).drawImage(jpg, { x: 0, y: 0, width: w, height: h })
  const bytes = await pdf.save()
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
