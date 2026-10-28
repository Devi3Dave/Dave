// Where every indicator's formula comes from, shown next to it in the indicator list.
// All indicators are computed in the app from the loaded candles; none is fetched ready-made
// from a data provider. `kind` says how closely the formula is tied to its reference:
// - talib: numerically compared with the TA-Lib C library (tests/referenceValues.test.ts)
// - formula: rebuilt from the original publication or open-source reference, not compared value by value
// - data: shows exchange data directly (volume, Binance taker-buy volume)
// - approx: open approximation of an indicator whose code is not public
// - estimate: own model without a public reference formula

export type ReferenceKind = "talib" | "formula" | "data" | "approx" | "estimate";

export interface IndicatorReference {
  kind: ReferenceKind;
  source: string;
}

export const REFERENCE_KIND_LABEL: Record<ReferenceKind, string> = {
  talib: "TA-Lib geprüft",
  formula: "Original-Formel",
  data: "Börsendaten",
  approx: "Annäherung",
  estimate: "Schätzung",
};

export const REFERENCE_KIND_TIP: Record<ReferenceKind, string> = {
  talib: "Selbst berechnet und Wert für Wert mit der Referenzbibliothek TA-Lib verglichen",
  formula: "Selbst berechnet nach der Originalquelle bzw. dem quelloffenen Vorbild",
  data: "Zeigt Daten der Börse direkt an",
  approx: "Nachbau eines Indikators, dessen Code nicht öffentlich ist",
  estimate: "Eigenes Schätzmodell, keine öffentliche Referenzformel",
};

const ref = (kind: ReferenceKind, source: string): IndicatorReference => ({ kind, source });

export const INDICATOR_REFERENCES: Record<string, IndicatorReference> = {
  // Muster
  candlepatterns: ref("formula", "Steve Nison, „Japanese Candlestick Charting Techniques“ (2001); ohne Kurslücken-Bedingung (Krypto 24/7)"),
  orderblocks: ref("formula", "smart-money-concepts smc.ob (joshyattridge); Buy/Sell beim ersten Retest ist eine eigene Regel"),
  fvg: ref("formula", "smart-money-concepts smc.fvg (joshyattridge) / Fair Value Gap [LuxAlgo]"),
  fvgnephew: ref("approx", "Nachbau nach der öffentlichen Beschreibung von „FVG (Nephew_Sam_)“ auf TradingView (Code nicht öffentlich); Lücke = Drei-Kerzen-Definition wie smart-money-concepts smc.fvg"),
  sessions: ref("approx", "Annäherung an Percocos „IT Foundation“ (Code nicht öffentlich); Handelszeiten von Tokio, London, NYSE"),
  structure: ref("formula", "smart-money-concepts smc.swing_highs_lows / smc.bos_choch (joshyattridge)"),
  chartpatterns: ref("formula", "Thomas Bulkowski, „Encyclopedia of Chart Patterns“ (2005)"),

  // Trend / Overlays
  sma: ref("talib", "TA-Lib SMA"),
  ema: ref("talib", "TA-Lib EMA (SMA-Start wie TradingView ta.ema)"),
  wma: ref("talib", "TA-Lib WMA"),
  hma: ref("formula", "Alan Hull (2005), wie pandas-ta hma"),
  vwma: ref("formula", "TradingView ta.vwma"),
  vwap: ref("formula", "TradingView ta.vwap, Tagesreset UTC"),
  bb: ref("talib", "John Bollinger; TA-Lib BBANDS"),
  keltner: ref("formula", "Linda Raschke / StockCharts, TradingView-Standard"),
  donchian: ref("formula", "Richard Donchian"),
  envelope: ref("formula", "Gleitender Durchschnitt ± Prozent (Standard-Envelope)"),
  ichimoku: ref("formula", "Goichi Hosoda, 9/26/52, Verschiebung wie TradingView"),
  psar: ref("talib", "J. Welles Wilder (1978); 1:1 nach TA-Lib SAR"),
  supertrend: ref("formula", "Olivier Seban; TradingView ta.supertrend"),
  pivots: ref("formula", "Floor-Trader-Pivots, TradingView „Pivot Points Standard“ (Traditional)"),

  // Volumen
  volume: ref("data", "Volumen der Börse; MA = SMA (TA-Lib geprüft)"),
  obv: ref("talib", "Joe Granville (1963); TA-Lib OBV"),
  mfi: ref("talib", "Quong & Soudack; TA-Lib MFI"),
  cmf: ref("formula", "Marc Chaikin, StockCharts"),

  // Momentum
  rsi: ref("talib", "J. Welles Wilder (1978); TA-Lib RSI"),
  rsicloud: ref("approx", "RSI TA-Lib geprüft; Divergenzen nach TradingViews quelloffenem „RSI Divergence Indicator“; Wolke angenähert an „Cloud Highlight RSI“ / Inevitrade"),
  macd: ref("talib", "Gerald Appel; TA-Lib MACD"),
  stoch: ref("talib", "George Lane; TA-Lib STOCH"),
  stochrsi: ref("formula", "Chande & Kroll (1994), wie TradingView"),
  cci: ref("talib", "Donald Lambert (1980); TA-Lib CCI"),
  willr: ref("talib", "Larry Williams; TA-Lib WILLR"),
  roc: ref("talib", "TA-Lib ROC"),
  mom: ref("talib", "TA-Lib MOM"),
  ao: ref("formula", "Bill Williams, „Trading Chaos“"),
  trix: ref("talib", "Jack Hutson (1983); TA-Lib TRIX (Skala wie TradingView)"),
  adx: ref("talib", "J. Welles Wilder (1978); TA-Lib ADX / PLUS_DI / MINUS_DI"),

  // Volatilität
  atr: ref("talib", "J. Welles Wilder (1978); TA-Lib ATR"),
  bbw: ref("formula", "John Bollinger: (oberes − unteres Band) / Mittelband"),
  stdev: ref("talib", "TA-Lib STDDEV"),

  // Weitere gleitende Durchschnitte
  dema: ref("talib", "Patrick Mulloy (1994); TA-Lib DEMA"),
  tema: ref("talib", "Patrick Mulloy (1994); TA-Lib TEMA"),
  smma: ref("formula", "J. Welles Wilder (RMA), wie TradingView ta.rma"),
  kama: ref("talib", "Perry Kaufman (1995); TA-Lib KAMA"),
  alma: ref("formula", "Legoux & Kouzis-Loukas (2009); TradingView ta.alma"),
  lsma: ref("talib", "TA-Lib LINEARREG"),
  mcginley: ref("formula", "John R. McGinley (1990)"),
  emaribbon: ref("formula", "Fünf Standard-EMAs (EMA TA-Lib geprüft)"),
  macross: ref("formula", "SMA 50 / SMA 200 (SMA TA-Lib geprüft); Golden / Death Cross"),

  // Bänder, Stops, Struktur
  vwapbands: ref("formula", "TradingView „VWAP“, Bänder per Standardabweichung"),
  avwap: ref("formula", "VWAP ab Ankerkerze (Brian Shannon)"),
  chandelier: ref("formula", "Chuck LeBeau, StockCharts ChartSchool"),
  alligator: ref("formula", "Bill Williams, „Trading Chaos“ (1995)"),
  fractals: ref("formula", "Bill Williams, „Trading Chaos“ (1995)"),
  zigzag: ref("formula", "Standard-ZigZag mit prozentualer Mindestumkehr"),
  linregchannel: ref("formula", "Kleinste-Quadrate-Regression ± Standardabweichung der Residuen"),
  vpvr: ref("formula", "Volume Profile mit POC / Value Area (TradingView „Fixed Range“)"),
  vpvr_visible: ref("formula", "TradingView „Visible Range Volume Profile“"),
  vp_session: ref("formula", "TradingView „Session Volume Profile“"),
  tpo: ref("formula", "J. Peter Steidlmayer, CBOT „Market Profile Handbook“"),

  // Krypto
  bmsb: ref("formula", "Benjamin Cowen: 20-Wochen-SMA / 21-Wochen-EMA"),
  picycle: ref("formula", "Philip Swift: 111-Tage-SMA / 2 × 350-Tage-SMA"),
  mayer: ref("formula", "Trace Mayer: Kurs / 200-Tage-SMA"),
  liqheatmap: ref("estimate", "Eigenes Modell nach der Idee von CoinGlass (Hebel 10×–100×); keine öffentliche Formel"),
  cvd: ref("data", "Binance-Taker-Kaufvolumen; bei anderen Quellen aus der Kerzenlage geschätzt"),
  delta: ref("data", "Binance-Taker-Kaufvolumen; bei anderen Quellen aus der Kerzenlage geschätzt"),
  wavetrend: ref("formula", "LazyBear „WaveTrend Oscillator [WT]“ (TradingView, quelloffen)"),
  squeeze: ref("formula", "LazyBear SQZMOM_LB; John Carters TTM Squeeze"),
  uo: ref("talib", "Larry Williams (1985); TA-Lib ULTOSC"),
  kdj: ref("formula", "Chinesische Standarddefinition (RSV 9, 1/3-Glättung)"),
  aroon: ref("talib", "Tushar Chande (1995); TA-Lib AROON"),
  vortex: ref("formula", "Botes & Siepman, TASC 2010"),
  fisher: ref("formula", "John Ehlers, TASC 2002; wie pandas-ta fisher"),
  crsi: ref("formula", "Connors Research, „An Introduction to ConnorsRSI“ (2012)"),
  stc: ref("formula", "Doug Schaff (1999)"),
  ppo: ref("talib", "TA-Lib PPO"),
  kst: ref("formula", "Martin Pring, StockCharts"),
  coppock: ref("formula", "Edwin Coppock (1962)"),
  dpo: ref("formula", "StockCharts ChartSchool"),
  choppiness: ref("formula", "E. W. Dreiss"),
  percentb: ref("formula", "John Bollinger (Bänder TA-Lib geprüft)"),
  hv: ref("formula", "Standardabweichung der Log-Renditen, annualisiert (365 Tage)"),
  adl: ref("talib", "Marc Chaikin; TA-Lib AD"),
  chaikinosc: ref("talib", "Marc Chaikin; TA-Lib ADOSC"),
  efi: ref("formula", "Alexander Elder"),
  klinger: ref("formula", "Stephen Klinger; TradingView-Standard"),
  eom: ref("formula", "Richard Arms; TradingView-Standard"),
  vo: ref("formula", "TradingView „Volume Oscillator“"),
  pvt: ref("formula", "StockCharts ChartSchool"),
  rvol: ref("formula", "Volumen / SMA(Volumen)"),
};

export function indicatorReference(id: string): IndicatorReference | undefined {
  return INDICATOR_REFERENCES[id];
}
