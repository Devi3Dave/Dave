import { useEffect, useRef, useState, type ReactNode } from "react";

interface Props {
  label: ReactNode;
  tip: string;
  className?: string;
  ariaLabel?: string;
  children: (close: () => void) => ReactNode;
}

/** Button with a drop-down panel; closes on outside tap or Escape. */
export function Menu({ label, tip, className, ariaLabel, children }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className={`pill ${className ?? ""} ${open ? "active" : ""}`} onClick={(e) => {
          // Fixed position: the top bar scrolls horizontally and would clip an absolute panel.
          const r = e.currentTarget.getBoundingClientRect();
          setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 268)) });
          setOpen((o) => !o);
        }} data-tip={open ? undefined : tip} aria-label={ariaLabel} aria-expanded={open}>
        {label}
      </button>
      {open && <div className="menu-panel" style={pos}>{children(() => setOpen(false))}</div>}
    </div>
  );
}
