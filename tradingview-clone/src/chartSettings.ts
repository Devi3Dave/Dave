// Chart display settings (scales, labels, time axis), persisted with the layout.

export type ScaleMode = "normal" | "log" | "percent" | "indexed";
export type GridMode = "both" | "vert" | "horz" | "none";
export type CrosshairSetting = "normal" | "magnet" | "hidden";

export interface ChartSettings {
  scaleMode: ScaleMode;
  invertScale: boolean;
  scalePosition: "right" | "left";
  lastPriceLabel: boolean;
  lastPriceLine: boolean;
  countdown: boolean;
  highLowLabels: boolean;
  headerPrice: boolean;
  timeZone: string; // "local", "UTC" or an IANA zone
  showSeconds: boolean;
  grid: GridMode;
  crosshair: CrosshairSetting;
  liveLiquidations: boolean;
  /** Renko box size in price units; 0 = ATR. */
  renkoBox: number;
  renkoAtr: number;
  /** Lines a Line Break reversal has to break (Nison: 3). */
  lineBreakLines: number;
}

export const DEFAULT_SETTINGS: ChartSettings = {
  scaleMode: "normal",
  invertScale: false,
  scalePosition: "right",
  lastPriceLabel: true,
  lastPriceLine: true,
  countdown: true,
  highLowLabels: false,
  headerPrice: true,
  timeZone: "local",
  showSeconds: false,
  grid: "both",
  crosshair: "normal",
  liveLiquidations: true,
  renkoBox: 0,
  renkoAtr: 14,
  lineBreakLines: 3,
};

export const TIME_ZONES: { id: string; label: string }[] = [
  { id: "local", label: "Lokal (Gerät)" },
  { id: "UTC", label: "UTC" },
  { id: "Europe/Berlin", label: "Berlin" },
  { id: "Europe/London", label: "London" },
  { id: "America/New_York", label: "New York" },
  { id: "America/Chicago", label: "Chicago" },
  { id: "Asia/Dubai", label: "Dubai" },
  { id: "Asia/Singapore", label: "Singapur" },
  { id: "Asia/Hong_Kong", label: "Hongkong" },
  { id: "Asia/Tokyo", label: "Tokio" },
  { id: "Australia/Sydney", label: "Sydney" },
];

/** The IANA zone a setting resolves to (the device zone for "local"). */
export function resolveTimeZone(tz: string): string {
  return tz === "local" ? Intl.DateTimeFormat().resolvedOptions().timeZone : tz;
}
