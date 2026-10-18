import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface TipState {
  text: string;
  x: number;
  y: number;
  placement: "right" | "below" | "above" | "left";
}

const DELAY_MS = 350;
const GAP = 8;

/**
 * Global hover hints for every element with a `data-tip` attribute.
 * Shown for mouse/trackpad pointers only, so taps on the iPad don't flash a hint.
 * `data-tip-placement` (right | below | above | left) overrides the automatic side.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<TipState | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const current = useRef<Element | null>(null);

  useEffect(() => {
    const hide = () => {
      window.clearTimeout(timer.current);
      current.current = null;
      setTip(null);
    };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const el = (e.target as Element | null)?.closest?.("[data-tip]");
      if (el === current.current) return;
      hide();
      if (!el) return;
      current.current = el;
      timer.current = window.setTimeout(() => {
        const text = el.getAttribute("data-tip");
        if (!text || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        const forced = el.getAttribute("data-tip-placement") as TipState["placement"] | null;
        // Vertical toolbars get the hint to the side, everything else below (or above near the bottom edge).
        const placement = forced ?? (r.left < 70 && r.height <= 60 ? "right" : r.bottom > window.innerHeight - 80 ? "above" : "below");
        const pos = {
          right: { x: r.right + GAP, y: r.top + r.height / 2 },
          left: { x: r.left - GAP, y: r.top + r.height / 2 },
          below: { x: r.left + r.width / 2, y: r.bottom + GAP },
          above: { x: r.left + r.width / 2, y: r.top - GAP },
        }[placement];
        setTip({ text, placement, ...pos });
      }, DELAY_MS);
    };

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerdown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerdown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
      window.clearTimeout(timer.current);
    };
  }, []);

  // Keep the hint inside the viewport (e.g. for buttons at the right edge).
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.marginLeft = "0px";
    const r = el.getBoundingClientRect();
    const margin = 6;
    if (r.right > window.innerWidth - margin) el.style.marginLeft = `${window.innerWidth - margin - r.right}px`;
    else if (r.left < margin) el.style.marginLeft = `${margin - r.left}px`;
  }, [tip]);

  if (!tip) return null;
  return (
    <div ref={box} className={`tooltip tooltip-${tip.placement}`} style={{ left: tip.x, top: tip.y }} role="tooltip">
      {tip.text}
    </div>
  );
}
