/**
 * MiCA status of the crypto exchanges in shared/venues.ts, and which of their products an EU/EEA resident may use.
 *
 * Only a hint, not legal advice. The status changes: every entry is "as of" MICA_AS_OF and names its sources.
 * The authoritative list is ESMA's interim MiCA register (CASPS.csv, esma.europa.eu → MiCA → Interim MiCA Register),
 * which lists each authorised crypto-asset service provider (CASP) with home state, authority and passported states.
 *
 * Rules behind the hints (Regulation (EU) 2023/1114, MiCA):
 * - Since the last national transition period ended on 2026-07-01, only an authorised CASP may offer crypto services
 *   (spot trading, custody, exchange) to EU/EEA residents. One authorisation is passported to every EEA state.
 * - Perpetuals, futures and options are financial instruments under MiFID II, not MiCA: a MiCA licence alone does not
 *   allow them; the exchange needs a separate MiFID II investment firm licence.
 * - Stablecoins that are not authorised e-money tokens (USDT) may not be offered for trading by CASPs to EU clients.
 *   Holding them is not forbidden. EUR pairs and USDC (authorised EMT, Circle) stay available, hence the EU mode.
 */
import type { Market } from "./venueMarkets.js";
import type { VenueId } from "./venues.js";

/** Day the entries below were checked (YYYY-MM-DD). */
export const MICA_AS_OF = "2026-10-28";

export const MICA_REGISTER_URL = "https://www.esma.europa.eu/esmas-activities/digital-finance-and-innovation/markets-crypto-assets-regulation-mica";

export type MicaStatus = "licensed" | "pending" | "none";

export interface MicaSource {
  label: string;
  url: string;
}

export interface MicaInfo {
  status: MicaStatus;
  /** Licensed or applying legal entity. */
  entity?: string;
  /** Home member state (ISO code) and authority that granted or examines the licence. */
  country?: string;
  authority?: string;
  /** Day the licence was granted or announced (YYYY-MM-DD). */
  since?: string;
  /** Crypto services the licence covers. */
  services?: string;
  /** EU platform when it differs from the global one ChartAI loads its charts from. */
  euSite?: string;
  /** Perpetuals, futures and options for EU residents (MiFID II). */
  derivatives: { allowed: boolean | "unclear"; text: string };
  /** What happened, in one or two sentences. */
  note: string;
  /** Something that limits the licence in practice. */
  warning?: string;
  sources: MicaSource[];
}

export const MICA: Record<VenueId, MicaInfo> = {
  COINBASE: {
    status: "licensed",
    entity: "Coinbase Luxembourg S.A.",
    country: "LU",
    authority: "CSSF (Luxemburg)",
    since: "2025-06-20",
    services: "Spot-Handel, Verwahrung, Tausch Krypto/Euro",
    derivatives: { allowed: true, text: "Futures über Coinbase Financial Services Europe Ltd. (MiFID II, CySEC Zypern)" },
    note: "MiCA-Lizenz der CSSF, gilt per Passport in allen EU-Staaten und ersetzt die früheren Einzellizenzen (DE, FR, IE, IT, NL, ES).",
    sources: [
      { label: "Finextra: Coinbase secures MiCA license in Luxembourg (Pressemitteilung)", url: "https://finextra.com/pressarticle/106051/coinbase-secures-mica-license-in-luxembourg" },
      { label: "The Crypto Register: MiFID-II-Derivate", url: "https://thecryptoregister.com/eu/derivatives" },
    ],
  },
  KRAKEN: {
    status: "licensed",
    entity: "Payward Europe Solutions Limited",
    country: "IE",
    authority: "Central Bank of Ireland",
    since: "2025-06-25",
    services: "Spot-Handel, Verwahrung, Tausch Krypto/Euro",
    derivatives: { allowed: true, text: "Perpetuals bis 10x über Payward Europe Digital Solutions (CY) Limited (MiFID II, CySEC Zypern)" },
    note: "MiCA-Lizenz der irischen Zentralbank, per Passport im ganzen EWR. Die französische AMF führt Kraken auf ihrer CASP-Whitelist.",
    sources: [
      { label: "Kraken-Pressemitteilung (Business Wire, 25.06.2025)", url: "https://www.businesswire.com/news/home/20250625529871/en" },
      { label: "AMF-Whitelist: Payward Europe Solutions Limited", url: "https://www.amf-france.org/en/warnings/white-lists/casp/payward-europe-solutions-limited-kraken-digital-asset-exchange-kraken" },
      { label: "The Crypto Register: MiFID-II-Derivate", url: "https://thecryptoregister.com/eu/derivatives" },
    ],
  },
  OKX: {
    status: "licensed",
    entity: "OKX Europe",
    country: "MT",
    authority: "MFSA (Malta)",
    since: "2025-01-27",
    services: "Spot-Handel, Verwahrung, Tausch Krypto/Euro",
    euSite: "my.okx.com",
    derivatives: { allowed: true, text: "Derivate über eine MiFID-II-Lizenz in Malta (im März 2025 angekündigt)" },
    note: "MiCA-Vorabgenehmigung der MFSA am 22.01.2025, volle Lizenz laut OKX am 27.01.2025, per Passport im ganzen EWR.",
    sources: [
      { label: "Cointelegraph: OKX MiCA pre-authorization (MFSA)", url: "https://cointelegraph.com/news/okx-pre-authorization-mica-compliance-malta-hub" },
      { label: "OKX-Europe-Pressemitteilung zur MiFID-II-Lizenz (März 2025)", url: "https://www.aap.com.au/aapreleases/cision20250312ae37772/" },
    ],
  },
  BYBIT: {
    status: "licensed",
    entity: "Bybit EU GmbH",
    country: "AT",
    authority: "FMA (Österreich)",
    since: "2025-05-29",
    services: "Spot-Handel, Verwahrung, Tausch Krypto/Euro",
    euSite: "bybit.eu",
    derivatives: { allowed: false, text: "Keine Perpetuals für EU-Kunden: MiFID-II-Antrag (Bybit X GmbH) läuft noch, keine Zulassung bekannt" },
    note: "MiCA-Lizenz der FMA, per Passport im ganzen EWR. EU-Kunden handeln auf bybit.eu, ChartAI lädt die Kurse von bybit.com.",
    sources: [
      { label: "Cointelegraph: Bybit secures MiCA license, EU HQ in Vienna", url: "https://cointelegraph.com/news/bybit-secures-mica-license-establishes-eu-hq-in-vienna" },
      { label: "Krypto-Investigation: Bybit beantragt MiFID-II-Lizenz", url: "https://krypto-investigation.de/en/bybit-applies-for-mifid-ii-license-migration-of-ewr-users-planned/" },
    ],
  },
  BITSTAMP: {
    status: "licensed",
    entity: "Bitstamp Europe S.A.",
    country: "LU",
    authority: "CSSF (Luxemburg)",
    since: "2025-05-15",
    services: "Handelsplattform, Verwahrung, Tausch Krypto/Euro, Orderausführung, Transfers",
    derivatives: { allowed: "unclear", text: "MiFID-Lizenz für ein MTF laut Fachpresse; Umfang für Privatkunden nicht geprüft" },
    note: "Erste MiCA-Lizenz der CSSF in Luxemburg; die AMF führt Bitstamp auf ihrer CASP-Whitelist (Passport ab 15.05.2025).",
    sources: [
      { label: "AMF-Whitelist: Bitstamp Europe S.A.", url: "https://www.amf-france.org/en/warnings/white-lists/casp/bitstamp-europe-sa" },
      { label: "Crowdfund Insider: Bitstamp approved for CASP license", url: "https://www.crowdfundinsider.com/2025/05/239791-bitstamp-approved-for-crypto-asset-service-provider-casp-license-under-mica/" },
    ],
  },
  KUCOIN: {
    status: "licensed",
    entity: "KuCoin EU Exchange GmbH",
    country: "AT",
    authority: "FMA (Österreich)",
    since: "2025-11-27",
    services: "Verwahrung, Tausch Krypto/Fiat und Krypto/Krypto, Platzierung, Transfers",
    derivatives: { allowed: false, text: "Keine MiFID-II-Zulassung bekannt" },
    note: "MiCA-Lizenz der FMA vom 27.11.2025.",
    warning: "Berichten zufolge untersagte die FMA am 18.02.2026 die Aufnahme des Geschäfts; die Quellen widersprechen sich, bitte im FMA- und ESMA-Register prüfen.",
    sources: [
      { label: "KuCoin-Pressemitteilung (PR Newswire)", url: "https://www.prnewswire.com/news-releases/kucoin-eu-secures-micar-license-to-deliver-regulated-digital-asset-services-in-europe-302628099.html" },
      { label: "Wake Up To Crypto: KuCoin MiCA – licensed, but can it operate?", url: "https://wakeuptocrypto.com/exchange/kucoin-mica-license-europe/" },
    ],
  },
  BINANCE: {
    status: "none",
    derivatives: { allowed: false, text: "Keine MiFID-II-Zulassung in der EU" },
    note: "Antrag in Griechenland am 24.06.2026 zurückgezogen. Seit 01.07.2026 keine Neukunden, Spot-Orders und Einzahlungen für EU-Kunden; Auszahlungen gehen weiter. Binance will in einem anderen EU-Staat neu beantragen.",
    sources: [
      { label: "France 24 (AFP): Binance to suspend crypto services in several EU countries", url: "https://www.france24.com/en/live-news/20260625-binance-to-suspend-crypto-services-in-several-eu-countries" },
      { label: "Zyphe: Binance MiCA licence status, still no EU approval", url: "https://www.zyphe.com/resources/news/binance-mica-licence-eu-lockout-july-2026" },
    ],
  },
  BITGET: {
    status: "pending",
    entity: "Bitget EU",
    country: "AT",
    authority: "FMA (Österreich)",
    derivatives: { allowed: false, text: "Keine MiFID-II-Zulassung in der EU" },
    note: "Antrag bei der FMA, von Bitget am 02.07.2026 bestätigt. Bis zur Zulassung bietet Bitget im EWR keine Dienste an.",
    sources: [
      { label: "The Cryptonomist: Bitget seeks MiCAR authorization", url: "https://en.cryptonomist.ch/2026/07/02/bitget-micar-authorization-eu/" },
      { label: "Penning: Bitget register check", url: "https://www.penning.io/mica/casp-register/bitget" },
    ],
  },
  BITFINEX: {
    status: "none",
    derivatives: { allowed: false, text: "Keine MiFID-II-Zulassung in der EU" },
    note: "Nicht im ESMA-Register, kein öffentlicher MiCA-Antrag bekannt. Darf seit 01.07.2026 im EWR keine Krypto-Dienste anbieten.",
    sources: [{ label: "The Crypto Register: Bitfinex MiCA-Vergleich", url: "https://thecryptoregister.com/eu/compare/from-bitfinex" }],
  },
  DERIBIT: {
    status: "none",
    derivatives: { allowed: false, text: "Nur Derivate (fallen unter MiFID II); keine EU-Zulassung gefunden" },
    note: "Nicht im ESMA-Register. Deribit gehört seit 2025 zu Coinbase, EU-Kunden bekommen Krypto-Futures über Coinbase Financial Services Europe.",
    sources: [{ label: "PerpFinder: Is Deribit MiCA-regulated?", url: "https://perpfinder.com/mica/deribit" }],
  },
  BITMEX: {
    status: "none",
    derivatives: { allowed: false, text: "Keine MiFID-II-Zulassung in der EU" },
    note: "Keine MiCA-Lizenz; BitMEX hat den Rückzug aus der EU angekündigt.",
    sources: [{ label: "CryptoTicker: MiCA-Register-Auswertung", url: "https://cryptoticker.io/en/mica-register-analysed-only-21-trading-platforms/" }],
  },
};

export const MICA_STATUS_LABEL: Record<MicaStatus, string> = { licensed: "MiCA-lizenziert", pending: "MiCA beantragt", none: "keine MiCA-Lizenz" };
export const MICA_STATUS_ICON: Record<MicaStatus, string> = { licensed: "✓", pending: "⏳", none: "✕" };

/** Where MiCA applies: the 27 EU states plus Iceland, Liechtenstein and Norway (EEA). Names in German. */
export const EEA_COUNTRIES: Record<string, string> = {
  BE: "Belgien",
  BG: "Bulgarien",
  DK: "Dänemark",
  DE: "Deutschland",
  EE: "Estland",
  FI: "Finnland",
  FR: "Frankreich",
  GR: "Griechenland",
  IE: "Irland",
  IS: "Island",
  IT: "Italien",
  HR: "Kroatien",
  LV: "Lettland",
  LI: "Liechtenstein",
  LT: "Litauen",
  LU: "Luxemburg",
  MT: "Malta",
  NL: "Niederlande",
  NO: "Norwegen",
  AT: "Österreich",
  PL: "Polen",
  PT: "Portugal",
  RO: "Rumänien",
  SE: "Schweden",
  SK: "Slowakei",
  SI: "Slowenien",
  ES: "Spanien",
  CZ: "Tschechien",
  HU: "Ungarn",
  CY: "Zypern",
};

/** Countries in the picker: EEA states, then a few neighbours where MiCA does not apply. */
export const OTHER_COUNTRIES: Record<string, string> = { CH: "Schweiz", GB: "Vereinigtes Königreich", TR: "Türkei", OTHER: "Anderes Land" };

export function countryName(code: string): string {
  return EEA_COUNTRIES[code] ?? OTHER_COUNTRIES[code] ?? code;
}

export const isEea = (code: string | null | undefined): boolean => !!code && code in EEA_COUNTRIES;

export type Availability = "yes" | "no" | "pending" | "unclear" | "local";

export interface VenueAvailability {
  /** Spot trading and custody. */
  spot: Availability;
  /** Perpetuals, futures and options. */
  derivatives: Availability;
  text: string;
}

/**
 * What a resident of `country` may use at an exchange under MiCA and MiFID II. Outside the EEA MiCA does not
 * apply ("local": the country's own rules decide). Country exceptions in a passport are not tracked: a licence counts for every EEA state.
 */
export function availabilityIn(country: string | null, venue: VenueId): VenueAvailability {
  const info = MICA[venue];
  if (!isEea(country)) return { spot: "local", derivatives: "local", text: "MiCA gilt hier nicht, es zählen die Regeln deines Landes." };
  const spot: Availability = info.status === "licensed" ? (info.warning ? "unclear" : "yes") : info.status === "pending" ? "pending" : "no";
  const derivatives: Availability = info.derivatives.allowed === true ? "yes" : info.derivatives.allowed === "unclear" ? "unclear" : "no";
  const where = countryName(country!);
  const text =
    spot === "yes"
      ? `Darf Krypto-Dienste in ${where} anbieten (MiCA-Passport aus ${countryName(info.country!)}).`
      : spot === "unclear"
        ? `Lizenziert, aber eingeschränkt: ${info.warning}`
        : spot === "pending"
          ? `Antrag läuft, bis zur Zulassung keine Krypto-Dienste in ${where}.`
          : `Darf seit 01.07.2026 keine Krypto-Dienste in ${where} anbieten.`;
  return { spot, derivatives, text };
}

/** Exchanges an EEA resident may use for spot (licensed, without a known restriction). */
export function allowedVenues(country: string | null, venues: VenueId[]): VenueId[] {
  return venues.filter((v) => {
    const a = availabilityIn(country, v).spot;
    return a === "yes" || a === "local";
  });
}

/**
 * Quotes the EU mode prefers instead of USDT: euro first, then USDC (an authorised e-money token under MiCA),
 * then EURC and plain USD. USDT and other stablecoins without EMT authorisation come last.
 */
export const EU_QUOTES = ["EUR", "USDC", "EURC", "USD"];

/** The spot market an EU mode loads for a coin: its EUR pair, else USDC, EURC or USD; null when the exchange lists none of them. */
export function euMarket(markets: Market[], base: string): Market | null {
  for (const quote of EU_QUOTES) {
    const m = markets.find((x) => x.kind === "spot" && x.base === base && x.quote === quote);
    if (m) return m;
  }
  return null;
}
