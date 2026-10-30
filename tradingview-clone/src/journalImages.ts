// Screenshots attached to journal trades. They live in IndexedDB, not in localStorage: a few images would fill
// localStorage's ~5 MB and blow up ☁ Sync. Trades only keep the image ids (JournalTrade.images); the backup file
// carries the pictures themselves.

const DB = "chartai-journal-images";
const STORE = "images";
/** Long edge after downscaling; enough to read a chart, about 150–300 kB as JPEG. */
const MAX_EDGE = 1600;

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error("Bildspeicher nicht verfügbar"));
    };
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(d.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("Bildspeicher-Fehler"));
      }),
  );
}

/** JPEG data URL of an image, or undefined when it is not on this device. */
export const getImage = (id: string) => run<string | undefined>("readonly", (s) => s.get(id) as IDBRequest<string | undefined>);
export const putImage = (id: string, dataUrl: string) => run("readwrite", (s) => s.put(dataUrl, id)).then(() => undefined);
export const deleteImage = (id: string) => run("readwrite", (s) => s.delete(id)).then(() => undefined);

export const newImageId = () => `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Draws a picture (file, paste, chart) into a canvas no larger than MAX_EDGE and returns it as JPEG. */
export async function shrinkImage(src: Blob | string): Promise<string> {
  const url = typeof src === "string" ? src : URL.createObjectURL(src);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("Bild konnte nicht gelesen werden");
    // Chart background behind transparent PNGs, JPEG has no alpha.
    ctx.fillStyle = "#131722";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.82);
  } finally {
    if (typeof src !== "string") URL.revokeObjectURL(url);
  }
}

/** Stores a picture and returns its new id. */
export async function addImage(src: Blob | string): Promise<string> {
  const id = newImageId();
  await putImage(id, await shrinkImage(src));
  return id;
}

/** All pictures of these ids that are on this device (for the backup file). */
export async function imagesFor(ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const id of ids) {
    const v = await getImage(id).catch(() => undefined);
    if (v) out[id] = v;
  }
  return out;
}

/** Takes pictures over from a backup file; ones already here stay. Returns how many were added. */
export async function restoreImages(images: unknown): Promise<number> {
  if (!images || typeof images !== "object") return 0;
  let added = 0;
  for (const [id, v] of Object.entries(images as Record<string, unknown>)) {
    if (typeof v !== "string" || !v.startsWith("data:image/")) continue;
    if (await getImage(id).catch(() => undefined)) continue;
    await putImage(id, v);
    added++;
  }
  return added;
}
