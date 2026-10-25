// Exchange holidays, computed per year: fixed dates, Easter-based days, "n-th
// weekday" rules, Chinese/Korean lunar dates and Islamic dates (via Intl
// calendars) plus each country's weekend substitution rules. Only Hindu
// festivals (NSE, Deepavali in Singapore) come from a table, since no
// calendar for them is built into the browser. Ad-hoc closures (elections,
// funerals, typhoons) and early closes are not covered.

export type HolidayCalendar = "us" | "ca" | "uk" | "de" | "fr" | "ch" | "jp" | "hk" | "cn" | "kr" | "sg" | "in" | "au";

/** "YYYY-MM-DD" of a date; overflowing days or months roll over like Date.UTC. */
export function isoDate(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
}

const toUtc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const addDays = (iso: string, n: number) => new Date(toUtc(iso) + n * 86400000).toISOString().slice(0, 10);
/** 0 = Sunday … 6 = Saturday. */
const weekday = (iso: string) => new Date(toUtc(iso)).getUTCDay();
const isWeekend = (iso: string) => weekday(iso) === 0 || weekday(iso) === 6;

/** Easter Sunday (Gregorian, anonymous algorithm). */
export function easter(y: number): string {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDate(y, month, day);
}

/** n-th given weekday of a month (n = -1: the last one). */
function nthWeekday(y: number, m: number, wd: number, n: number): string {
  if (n < 0) {
    const last = isoDate(y, m + 1, 0);
    return addDays(last, -((weekday(last) - wd + 7) % 7));
  }
  const first = isoDate(y, m, 1);
  return addDays(first, ((wd - weekday(first) + 7) % 7) + (n - 1) * 7);
}

// Lunar and Islamic dates: the Gregorian day of a month/day in another calendar.
const lunarCache = new Map<string, Map<string, string>>();

function calendarDays(calendar: string, y: number): Map<string, string> {
  const key = `${calendar}:${y}`;
  let days = lunarCache.get(key);
  if (!days) {
    days = new Map();
    const fmt = new Intl.DateTimeFormat(`en-u-ca-${calendar}`, { timeZone: "UTC", month: "numeric", day: "numeric" });
    // Leap months come out as e.g. "6bis" and so never match a regular month.
    for (let t = Date.UTC(y, 0, 1); t < Date.UTC(y + 1, 0, 1); t += 86400000) {
      const md = fmt.format(new Date(t + 43200000));
      if (!days.has(md)) days.set(md, new Date(t).toISOString().slice(0, 10));
    }
    lunarCache.set(key, days);
  }
  return days;
}

function inCalendar(calendar: string, y: number, m: number, d: number): string | undefined {
  try {
    return calendarDays(calendar, y).get(`${m}/${d}`);
  } catch {
    return undefined; // Intl without that calendar
  }
}

const chinese = (y: number, m: number, d: number) => inCalendar("chinese", y, m, d);
const dangi = (y: number, m: number, d: number) => inCalendar("dangi", y, m, d);
/** Umm al-Qura plus one day matches the sighting-based dates in India and Singapore far better. */
const islamic = (y: number, m: number, d: number) => {
  const day = inCalendar("islamic-umalqura", y, m, d);
  return day && addDays(day, 1);
};

/** Qingming (Ching Ming), the solar term around 4/5 April (valid 2000–2099). */
function qingming(y: number): string {
  const c = y % 100;
  return isoDate(y, 4, Math.floor(c * 0.2422 + 4.81) - Math.floor(c / 4));
}

/** Japanese equinox days (valid 1980–2099). */
function equinox(y: number, base: number, m: number): string {
  return isoDate(y, m, Math.floor(base + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4)));
}

/**
 * Dates from the exchanges' published holiday lists for festivals that follow the
 * Hindu calendar, and Islamic dates that differ from the computed ones.
 */
const TABLE: Partial<Record<HolidayCalendar, Record<number, [string, string][]>>> = {
  in: {
    2025: [
      ["2025-02-26", "Mahashivratri"],
      ["2025-03-14", "Holi"],
      ["2025-04-10", "Mahavir Jayanti"],
      ["2025-08-27", "Ganesh Chaturthi"],
      ["2025-10-21", "Diwali Laxmi Pujan"],
      ["2025-10-22", "Diwali Balipratipada"],
      ["2025-11-05", "Guru Nanak Jayanti"],
    ],
    2026: [
      ["2026-02-15", "Mahashivratri"],
      ["2026-03-03", "Holi"],
      ["2026-03-26", "Ram Navami"],
      ["2026-03-31", "Mahavir Jayanti"],
      ["2026-09-14", "Ganesh Chaturthi"],
      ["2026-10-20", "Dussehra"],
      ["2026-11-08", "Diwali Laxmi Pujan"],
      ["2026-11-10", "Diwali Balipratipada"],
      ["2026-11-24", "Guru Nanak Jayanti"],
    ],
    2027: [
      ["2027-03-22", "Holi"],
      ["2027-06-15", "Muharram"],
      ["2027-09-04", "Ganesh Chaturthi"],
    ],
  },
  sg: {
    2025: [["2025-10-20", "Deepavali"]],
    2026: [
      ["2026-05-27", "Hari Raya Haji"],
      ["2026-11-08", "Deepavali"],
    ],
    2027: [["2027-10-28", "Deepavali"]],
  },
};

/**
 * How a holiday on a weekend is made up:
 * - "none": not at all
 * - "next": Saturday or Sunday moves to the next free weekday
 * - "sunday": only Sunday moves (to the next free day)
 * - "us": Saturday moves to Friday, Sunday to Monday
 * Any rule except "none" also moves a holiday that collides with an earlier one.
 */
type Shift = "none" | "next" | "sunday" | "us";

class Holidays {
  readonly days = new Map<string, string>();

  add(iso: string | undefined, name: string, shift: Shift = "none") {
    if (!iso) return;
    if (shift === "us") {
      const wd = weekday(iso);
      iso = wd === 6 ? addDays(iso, -1) : wd === 0 ? addDays(iso, 1) : iso;
    } else if (shift !== "none") {
      const moves = (d: string) => this.days.has(d) || (shift === "next" ? isWeekend(d) : weekday(d) === 0);
      if (moves(iso)) {
        do iso = addDays(iso, 1);
        while (this.days.has(iso) || isWeekend(iso));
      }
    }
    if (!this.days.has(iso)) this.days.set(iso, name);
  }

  range(from: string, to: string, name: string) {
    for (let d = from; d <= to; d = addDays(d, 1)) this.add(d, name);
  }
}

function build(cal: HolidayCalendar, y: number): Map<string, string> {
  const h = new Holidays();
  const e = easter(y);
  const goodFriday = addDays(e, -2);
  const easterMonday = addDays(e, 1);
  const d = (m: number, day: number) => isoDate(y, m, day);

  switch (cal) {
    case "us":
      // New Year on a Saturday is not made up on 31 December (NYSE rule 7.2).
      if (weekday(d(1, 1)) !== 6) h.add(d(1, 1), "Neujahr", "us");
      h.add(nthWeekday(y, 1, 1, 3), "Martin Luther King Day");
      h.add(nthWeekday(y, 2, 1, 3), "Presidents' Day");
      h.add(goodFriday, "Karfreitag");
      h.add(nthWeekday(y, 5, 1, -1), "Memorial Day");
      if (y >= 2022) h.add(d(6, 19), "Juneteenth", "us");
      h.add(d(7, 4), "Unabhängigkeitstag", "us");
      h.add(nthWeekday(y, 9, 1, 1), "Labor Day");
      h.add(nthWeekday(y, 11, 4, 4), "Thanksgiving");
      h.add(d(12, 25), "Weihnachten", "us");
      break;
    case "ca":
      h.add(d(1, 1), "Neujahr", "next");
      h.add(nthWeekday(y, 2, 1, 3), "Family Day");
      h.add(goodFriday, "Karfreitag");
      h.add(addDays(d(5, 24), -((weekday(d(5, 24)) + 6) % 7)), "Victoria Day");
      h.add(d(7, 1), "Canada Day", "next");
      h.add(nthWeekday(y, 8, 1, 1), "Civic Holiday");
      h.add(nthWeekday(y, 9, 1, 1), "Labour Day");
      h.add(nthWeekday(y, 10, 1, 2), "Thanksgiving");
      h.add(d(12, 25), "Weihnachten", "next");
      h.add(d(12, 26), "Boxing Day", "next");
      break;
    case "uk":
      h.add(d(1, 1), "Neujahr", "next");
      h.add(goodFriday, "Karfreitag");
      h.add(easterMonday, "Ostermontag");
      h.add(nthWeekday(y, 5, 1, 1), "Early May Bank Holiday");
      h.add(nthWeekday(y, 5, 1, -1), "Spring Bank Holiday");
      h.add(nthWeekday(y, 8, 1, -1), "Summer Bank Holiday");
      h.add(d(12, 25), "Weihnachten", "next");
      h.add(d(12, 26), "Boxing Day", "next");
      break;
    case "de":
      h.add(d(1, 1), "Neujahr");
      h.add(goodFriday, "Karfreitag");
      h.add(easterMonday, "Ostermontag");
      h.add(d(5, 1), "Tag der Arbeit");
      h.add(d(12, 24), "Heiligabend");
      h.add(d(12, 25), "1. Weihnachtstag");
      h.add(d(12, 26), "2. Weihnachtstag");
      h.add(d(12, 31), "Silvester");
      break;
    case "fr":
      h.add(d(1, 1), "Neujahr");
      h.add(goodFriday, "Karfreitag");
      h.add(easterMonday, "Ostermontag");
      h.add(d(5, 1), "Tag der Arbeit");
      h.add(d(12, 25), "Weihnachten");
      h.add(d(12, 26), "Stephanstag");
      break;
    case "ch":
      h.add(d(1, 1), "Neujahr");
      h.add(d(1, 2), "Berchtoldstag");
      h.add(goodFriday, "Karfreitag");
      h.add(easterMonday, "Ostermontag");
      h.add(d(5, 1), "Tag der Arbeit");
      h.add(addDays(e, 39), "Auffahrt");
      h.add(addDays(e, 50), "Pfingstmontag");
      h.add(d(8, 1), "Bundesfeiertag");
      h.add(d(12, 24), "Heiligabend");
      h.add(d(12, 25), "Weihnachten");
      h.add(d(12, 26), "Stephanstag");
      h.add(d(12, 31), "Silvester");
      break;
    case "jp": {
      const national: [string, string][] = [
        [d(1, 1), "Neujahr"],
        [nthWeekday(y, 1, 1, 2), "Tag der Volljährigkeit"],
        [d(2, 11), "Staatsgründungstag"],
        [d(2, 23), "Geburtstag des Kaisers"],
        [equinox(y, 20.8431, 3), "Frühlingsanfang"],
        [d(4, 29), "Shōwa-Tag"],
        [d(5, 3), "Verfassungstag"],
        [d(5, 4), "Tag des Grüns"],
        [d(5, 5), "Kindertag"],
        [nthWeekday(y, 7, 1, 3), "Tag des Meeres"],
        [d(8, 11), "Tag der Berge"],
        [nthWeekday(y, 9, 1, 3), "Tag der Achtung vor dem Alter"],
        [equinox(y, 23.2488, 9), "Herbstanfang"],
        [nthWeekday(y, 10, 1, 2), "Tag des Sports"],
        [d(11, 3), "Kulturtag"],
        [d(11, 23), "Tag des Dankes für die Arbeit"],
      ];
      for (const [day, name] of national) h.add(day, name);
      // A day between two holidays is a holiday too (e.g. September 2026).
      for (const [day] of national) {
        const between = addDays(day, 1);
        if (h.days.has(addDays(day, 2)) && !h.days.has(between) && weekday(between) !== 0) h.add(between, "Volksfeiertag");
      }
      // A holiday on Sunday moves to the next day that is not a holiday.
      for (const [day, name] of national) if (weekday(day) === 0) h.add(day, `${name} (Ersatz)`, "sunday");
      h.add(d(1, 2), "Börsenferien");
      h.add(d(1, 3), "Börsenferien");
      h.add(d(12, 31), "Börsenferien");
      break;
    }
    case "hk":
      h.add(d(1, 1), "Neujahr", "sunday");
      for (const day of [1, 2, 3]) h.add(chinese(y, 1, day), "Chinesisches Neujahr", "sunday");
      h.add(goodFriday, "Karfreitag");
      h.add(easterMonday, "Ostermontag");
      h.add(qingming(y), "Ching Ming", "sunday");
      h.add(d(5, 1), "Tag der Arbeit", "sunday");
      h.add(chinese(y, 4, 8), "Buddhas Geburtstag", "sunday");
      h.add(chinese(y, 5, 5), "Drachenbootfest", "sunday");
      h.add(d(7, 1), "Tag der Sonderverwaltungszone", "sunday");
      h.add(chinese(y, 8, 16), "Tag nach dem Mondfest", "sunday");
      h.add(d(10, 1), "Nationalfeiertag", "sunday");
      h.add(chinese(y, 9, 9), "Chung Yeung", "sunday");
      h.add(d(12, 25), "Weihnachten", "sunday");
      h.add(d(12, 26), "Boxing Day", "sunday");
      break;
    case "cn": {
      // The State Council sets the exact closures each year; these are the usual patterns.
      h.add(d(1, 1), "Neujahr", "next");
      const newYear = chinese(y, 1, 1);
      if (newYear) h.range(addDays(newYear, -1), chinese(y, 1, 7) ?? addDays(newYear, 6), "Frühlingsfest");
      h.add(qingming(y), "Qingming", "next");
      h.range(d(5, 1), d(5, 5), "Tag der Arbeit");
      h.add(chinese(y, 5, 5), "Drachenbootfest", "next");
      const midAutumn = chinese(y, 8, 15);
      if (midAutumn && midAutumn >= d(9, 28) && midAutumn <= d(10, 8)) {
        // Merged with the National Day week.
        const from = midAutumn < d(10, 1) ? midAutumn : d(10, 1);
        h.range(from, addDays(from, 7), "Nationalfeiertag / Mondfest");
      } else {
        h.add(midAutumn, "Mondfest", "next");
        h.range(d(10, 1), d(10, 7), "Nationalfeiertag");
      }
      break;
    }
    case "kr": {
      h.add(d(1, 1), "Neujahr");
      const seollal = dangi(y, 1, 1);
      if (seollal) for (const n of [-1, 0, 1]) h.add(addDays(seollal, n), "Seollal", "sunday");
      h.add(d(3, 1), "Unabhängigkeitsbewegung", "next");
      h.add(d(5, 1), "Tag der Arbeit");
      h.add(d(5, 5), "Kindertag", "next");
      h.add(dangi(y, 4, 8), "Buddhas Geburtstag", "next");
      h.add(d(6, 6), "Gedenktag");
      h.add(d(8, 15), "Befreiungstag", "next");
      const chuseok = dangi(y, 8, 15);
      if (chuseok) for (const n of [-1, 0, 1]) h.add(addDays(chuseok, n), "Chuseok", "sunday");
      h.add(d(10, 3), "Tag der Staatsgründung", "next");
      h.add(d(10, 9), "Hangeul-Tag", "next");
      h.add(d(12, 25), "Weihnachten", "next");
      h.add(d(12, 31), "Jahresende (Börse)");
      break;
    }
    case "sg": {
      const table = new Map((TABLE.sg?.[y] ?? []).map(([day, name]) => [name, day]));
      h.add(d(1, 1), "Neujahr", "sunday");
      h.add(chinese(y, 1, 1), "Chinesisches Neujahr", "sunday");
      h.add(chinese(y, 1, 2), "Chinesisches Neujahr", "sunday");
      h.add(goodFriday, "Karfreitag");
      h.add(d(5, 1), "Tag der Arbeit", "sunday");
      h.add(table.get("Hari Raya Puasa") ?? islamic(y, 10, 1), "Hari Raya Puasa", "sunday");
      h.add(chinese(y, 4, 15), "Vesak", "sunday");
      h.add(table.get("Hari Raya Haji") ?? islamic(y, 12, 10), "Hari Raya Haji", "sunday");
      h.add(d(8, 9), "Nationalfeiertag", "sunday");
      h.add(table.get("Deepavali"), "Deepavali", "sunday");
      h.add(d(12, 25), "Weihnachten", "sunday");
      break;
    }
    case "in": {
      const table = TABLE.in?.[y] ?? [];
      const listed = (name: string) => table.find(([, n]) => n === name)?.[0];
      h.add(d(1, 26), "Tag der Republik");
      h.add(goodFriday, "Karfreitag");
      h.add(d(4, 14), "Ambedkar Jayanti");
      h.add(d(5, 1), "Maharashtra Day");
      h.add(d(8, 15), "Unabhängigkeitstag");
      h.add(d(10, 2), "Gandhi Jayanti");
      h.add(d(12, 25), "Weihnachten");
      h.add(listed("Id-ul-Fitr") ?? islamic(y, 10, 1), "Id-ul-Fitr");
      h.add(listed("Bakri Id") ?? islamic(y, 12, 10), "Bakri Id");
      h.add(listed("Muharram") ?? islamic(y, 1, 10), "Muharram");
      for (const [day, name] of table) h.add(day, name);
      break;
    }
    case "au":
      h.add(d(1, 1), "Neujahr", "next");
      h.add(d(1, 26), "Australia Day", "next");
      h.add(goodFriday, "Karfreitag");
      h.add(easterMonday, "Ostermontag");
      h.add(d(4, 25), "Anzac Day");
      h.add(nthWeekday(y, 6, 1, 2), "King's Birthday");
      h.add(d(12, 25), "Weihnachten", "next");
      h.add(d(12, 26), "Boxing Day", "next");
      break;
  }
  return h.days;
}

const cache = new Map<string, Map<string, string>>();

/** All holidays of a calendar in a year, date → name (weekend dates included). */
export function holidaysOf(cal: HolidayCalendar, y: number): Map<string, string> {
  const key = `${cal}:${y}`;
  let days = cache.get(key);
  if (!days) {
    days = build(cal, y);
    cache.set(key, days);
  }
  return days;
}

/** Name of the holiday on a date ("YYYY-MM-DD"), if it is one. */
export function holidayOn(cal: HolidayCalendar, date: string): string | undefined {
  return holidaysOf(cal, Number(date.slice(0, 4))).get(date);
}

/** True when a calendar has only partial data for a year (Hindu festivals not yet listed). */
export function holidaysIncomplete(cal: HolidayCalendar, y: number): boolean {
  return (cal === "in" || cal === "sg") && !TABLE[cal]?.[y];
}
