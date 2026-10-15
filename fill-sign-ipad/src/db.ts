import type { DocMeta } from './types'

// Documents live in IndexedDB: metadata (incl. annotations) and the original file bytes
// are kept in separate stores so the library list never has to load whole PDFs.
const DB_NAME = 'fill-sign'
const META = 'docs'
const FILES = 'files'

let dbPromise: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(META, { keyPath: 'id' })
      req.result.createObjectStore(FILES)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await db()
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode)
    const req = fn(tx.objectStore(store))
    tx.oncomplete = () => resolve(req.result as T)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export async function listDocs(): Promise<DocMeta[]> {
  const all = await run<DocMeta[]>(META, 'readonly', (s) => s.getAll())
  return all.sort((a, b) => b.updatedAt - a.updatedAt)
}

export const getDoc = (id: string) => run<DocMeta | undefined>(META, 'readonly', (s) => s.get(id))
export const putDoc = (doc: DocMeta) => run<void>(META, 'readwrite', (s) => s.put(doc))
export const getFile = (id: string) => run<ArrayBuffer | undefined>(FILES, 'readonly', (s) => s.get(id))
export const putFile = (id: string, bytes: ArrayBuffer) => run<void>(FILES, 'readwrite', (s) => s.put(bytes, id))

export async function deleteDoc(id: string) {
  await run(META, 'readwrite', (s) => s.delete(id))
  await run(FILES, 'readwrite', (s) => s.delete(id))
}
