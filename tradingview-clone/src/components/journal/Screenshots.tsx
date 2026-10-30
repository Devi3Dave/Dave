import { useEffect, useRef, useState } from "react";
import { addImage, deleteImage, getImage } from "../../journalImages";

/** Loads the pictures of these ids; null = not on this device, undefined = still loading. */
function useImages(ids: string[]): Record<string, string | null | undefined> {
  const [map, setMap] = useState<Record<string, string | null | undefined>>({});
  const key = ids.join(",");
  useEffect(() => {
    let alive = true;
    for (const id of ids) {
      if (map[id] !== undefined) continue;
      getImage(id)
        .then((v) => alive && setMap((m) => ({ ...m, [id]: v ?? null })))
        .catch(() => alive && setMap((m) => ({ ...m, [id]: null })));
    }
    return () => {
      alive = false;
    };
  }, [key]);
  return map;
}

/**
 * Screenshots of a trade: add from a file or the photo library, take the current chart, paste (⌘V) or drop a picture;
 * tap one to see it large.
 */
export function Screenshots({ ids, onChange, chartShot }: { ids: string[]; onChange: (ids: string[]) => void; chartShot?: () => string | null }) {
  const images = useImages(ids);
  const [big, setBig] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const idsRef = useRef(ids);
  idsRef.current = ids;

  const add = async (sources: (Blob | string)[]) => {
    if (!sources.length) return;
    setBusy(true);
    setError(null);
    try {
      const added: string[] = [];
      for (const s of sources) added.push(await addImage(s));
      onChange([...idsRef.current, ...added]);
    } catch (e) {
      setError(`Bild konnte nicht gespeichert werden: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  // ⌘V / Ctrl+V with a picture in the clipboard, while this trade is open.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.items ?? [])].filter((i) => i.type.startsWith("image/")).map((i) => i.getAsFile()).filter((f): f is File => !!f);
      if (!files.length) return;
      e.preventDefault();
      void add(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  useEffect(() => {
    if (big === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setBig(null);
      } else if (e.key === "ArrowLeft") setBig((b) => (b === null ? b : Math.max(0, b - 1)));
      else if (e.key === "ArrowRight") setBig((b) => (b === null ? b : Math.min(ids.length - 1, b + 1)));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [big, ids.length]);

  const remove = (id: string) => {
    onChange(ids.filter((x) => x !== id));
    void deleteImage(id).catch(() => undefined);
    setConfirm(null);
    setBig(null);
  };

  const shownId = big === null ? null : ids[big];

  return (
    <div
      className="calc-field jz-shots"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void add([...e.dataTransfer.files].filter((f) => f.type.startsWith("image/")));
      }}
    >
      <span>Screenshots</span>
      <div className="jz-shot-row">
        {ids.map((id, i) => {
          const src = images[id];
          return (
            <button key={id} className="jz-shot" onClick={() => src && setBig(i)} data-tip={src === null ? "Dieses Bild liegt auf dem anderen Gerät – über ⤓ Backup / ⤒ Import herholen" : "Groß ansehen"}>
              {src ? <img src={src} alt={`Screenshot ${i + 1}`} /> : <em>{src === null ? "auf anderem Gerät" : "…"}</em>}
            </button>
          );
        })}
        <button className="jz-shot jz-shot-add" onClick={() => fileRef.current?.click()} disabled={busy} data-tip={"Bild aus Dateien oder Fotos wählen\nam Mac auch: Bild hierher ziehen oder mit ⌘V einfügen"}>
          {busy ? "…" : "＋ Bild"}
        </button>
        {chartShot && (
          <button
            className="jz-shot jz-shot-add"
            disabled={busy}
            onClick={() => {
              const shot = chartShot();
              if (shot) void add([shot]);
              else setError("Kein Chart geladen");
            }}
            data-tip="Den Chart hinter dem Journal so aufnehmen, wie er gerade aussieht"
          >
            📈 Chart aufnehmen
          </button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void add([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      {error && <div className="calc-warn">{error}</div>}

      {shownId && images[shownId] && (
        <div className="jz-lightbox" onClick={() => setBig(null)}>
          <img src={images[shownId]!} alt="Screenshot groß" onClick={(e) => e.stopPropagation()} />
          <div className="jz-lightbox-bar" onClick={(e) => e.stopPropagation()}>
            <button disabled={big === 0} onClick={() => setBig((b) => (b ?? 1) - 1)} aria-label="Vorheriges Bild">
              ‹
            </button>
            <span>
              {big! + 1} / {ids.length}
            </span>
            <button disabled={big === ids.length - 1} onClick={() => setBig((b) => (b ?? 0) + 1)} aria-label="Nächstes Bild">
              ›
            </button>
            <div className="spacer" />
            {confirm === shownId ? (
              <>
                <button className="jr-danger" onClick={() => remove(shownId)}>
                  Bild löschen
                </button>
                <button onClick={() => setConfirm(null)}>Nein</button>
              </>
            ) : (
              <button onClick={() => setConfirm(shownId)}>🗑</button>
            )}
            <button onClick={() => setBig(null)} aria-label="Schließen">
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
