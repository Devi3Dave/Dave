import type { ReactNode } from "react";

// Plain-language explanations for the calculator page: what a formula means, how to use it, an example.

export interface Help {
  what: ReactNode;
  steps: ReactNode[];
  example: ReactNode;
  tip?: ReactNode;
}

export const BASICS: Help = {
  what: (
    <>
      <strong>R</strong> ist deine Risiko-Einheit: der Betrag, den du verlierst, wenn ein Trade seinen Stop-Loss trifft. Statt in Euro oder Dollar
      zu denken, zählst du in R. Ein Verlust ist immer <strong>−1 R</strong>, ein Gewinn ist ein Vielfaches davon, z. B. <strong>+4 R</strong>.
    </>
  ),
  steps: [
    <>Lege einmal fest, wie viel du pro Trade höchstens verlieren willst (z. B. 100 $ oder 1 % deines Kontos). Das ist dein 1 R.</>,
    <>Trage den Betrag oben bei „Risiko pro Trade (1 R)“ ein. Alle Rechner auf dieser Seite rechnen damit.</>,
    <>Vor jedem Trade: Positionsgröße ausrechnen (1), Ziel festlegen (3), Hebel prüfen (5).</>,
  ],
  example: <>Risiko 100 $ → 1 R = 100 $. Ein Trade mit +4 R bringt 400 $, ein Verlust kostet 100 $.</>,
  tip: <>Weil jeder Verlust gleich groß ist, entscheidet nicht die Trefferquote allein, sondern das Verhältnis von Gewinnen zu Verlusten.</>,
};

export const HELP: Record<string, Help> = {
  position: {
    what: (
      <>
        Die Positionsgröße sagt dir, <strong>wie viele Einheiten</strong> (Aktien, Coins, Kontrakte) du kaufst, damit du beim Stop-Loss genau 1 R
        verlierst – nicht mehr und nicht weniger. Liegt der Stop weit weg, kaufst du weniger; liegt er nah, kaufst du mehr.
      </>
    ),
    steps: [
      <>Einstiegspreis eintragen: der Kurs, zu dem du kaufen (Long) oder verkaufen (Short) willst.</>,
      <>Stop-Loss eintragen: der Kurs, bei dem deine Idee falsch ist und du aussteigst. Liegt er unter dem Einstieg, ist es ein Long, darüber ein Short.</>,
      <>Risiko eintragen. Rechnung: Risiko ÷ Abstand zwischen Einstieg und Stop.</>,
      <>Die gelbe Zahl ist die Menge, die du in deiner Order eingibst.</>,
    ],
    example: (
      <>
        Einstieg 135,50 $, Stop 130,00 $ → Abstand 5,50 $. Risiko 100 $ ÷ 5,50 $ = <strong>18,18 Einheiten</strong>. Fällt der Kurs auf 130 $,
        verlierst du 18,18 × 5,50 $ = 100 $.
      </>
    ),
    tip: <>Erst den Stop an eine sinnvolle Stelle im Chart setzen, dann die Größe ausrechnen – nie umgekehrt.</>,
  },
  expectancy: {
    what: (
      <>
        Der Erwartungswert zeigt, wie viel du <strong>im Durchschnitt pro Trade</strong> verdienst, wenn du sehr viele Trades machst. Ist er
        positiv, hast du einen Vorteil (Edge) – auch wenn du die meisten Trades verlierst.
      </>
    ),
    steps: [
      <>Trefferquote eintragen: wie viele von 100 Trades gewinnen (aus deinem Trading-Journal oder Backtest).</>,
      <>Ø Gewinn eintragen: wie viele R ein Gewinner im Schnitt bringt. Ø Verlust ist normalerweise 1 R.</>,
      <>Rechnung: (Trefferquote × Ø Gewinn) − (Verlustquote × Ø Verlust). Ergebnis in R, mal Risiko = Dollar pro Trade.</>,
      <>In der Grafik siehst du, ab welcher Trefferquote (gelbe Linie) dein System ins Plus kommt.</>,
    ],
    example: (
      <>
        30 % Treffer mit je +3,8 R, 70 % Verluste mit je −1 R: 0,30 × 3,8 = 1,14 R, minus 0,70 × 1 = 0,70 R → <strong>+0,44 R</strong>. Bei 100 $
        Risiko sind das 44 $ pro Trade, also rund 4.400 $ nach 100 Trades.
      </>
    ),
    tip: <>Größere Gewinne (mehr R) senken die nötige Trefferquote. Bei 4 R reichen schon 20 % Treffer zum Break-even.</>,
  },
  simulation: {
    what: (
      <>
        Der Erwartungswert gilt nur im Durchschnitt. Diese Simulation zeigt, wie <strong>unterschiedlich</strong> echte Trade-Serien mit
        denselben Werten verlaufen können – inklusive Verlustphasen.
      </>
    ),
    steps: [
      <>Trefferquote und Ø Gewinn kommen aus Rechner 2. Hier stellst du nur die Anzahl Trades ein.</>,
      <>Jede blaue Linie ist eine mögliche Serie, die dicke ist hervorgehoben. Gelb gestrichelt ist der erwartete Verlauf.</>,
      <>„Max. Drawdown“ ist der größte Rückgang vom Höchststand. „Längste Verlustserie“ zählt die Verluste am Stück.</>,
      <>Mit 🎲 neu würfeln und schauen, wie stark die Ergebnisse schwanken.</>,
    ],
    example: (
      <>
        Bei 30 % Trefferquote sind 5 oder mehr Verluste in Folge ganz normal. Wer das vorher weiß, bleibt bei seinem System, statt nach einer
        Pechsträhne aufzugeben.
      </>
    ),
    tip: <>Je mehr Trades, desto näher liegen die Linien am Erwartungswert. Bei wenigen Trades entscheidet viel Zufall.</>,
  },
  rmultiple: {
    what: (
      <>
        Das R-Multiple sagt, wie viel <strong>mal dein Risiko</strong> du gewinnst. 1:4 heißt: du riskierst 1 R und willst 4 R gewinnen.
        Daraus ergeben sich Gewinn in Dollar und der Kurs für deinen Take-Profit.
      </>
    ),
    steps: [
      <>Gewünschtes R-Multiple einstellen (Standard 4 R, bei größeren Bewegungen 8–15 R) – oder einen Balken antippen.</>,
      <>Gewinn = R-Multiple × Risiko.</>,
      <>Zielpreis = Einstieg + R × (Einstieg − Stop). Diesen Kurs als Take-Profit in die Order eintragen.</>,
    ],
    example: (
      <>
        Einstieg 135,50 $, Stop 130,00 $ (5,50 $ Abstand), Ziel 4 R: 135,50 + 4 × 5,50 = <strong>157,50 $</strong>. Bei 100 $ Risiko bringt das
        400 $.
      </>
    ),
    tip: <>„Break-even-Trefferquote“ zeigt, wie oft dieses Ziel mindestens erreicht werden muss, damit du nicht verlierst.</>,
  },
  fibonacci: {
    what: (
      <>
        Kurse laufen selten gerade. Nach einer Bewegung (Impuls) kommt oft ein Rücksetzer. <strong>Retracements</strong> zeigen typische
        Rücksetzer-Zonen für den Einstieg, <strong>Extensions</strong> mögliche Kursziele für die nächste Bewegung.
      </>
    ),
    steps: [
      <>A = Start des Impulses (z. B. das Tief), B = Ende des Impulses (das Hoch).</>,
      <>Die Retracement-Tabelle zeigt, wohin der Kurs zurücklaufen könnte. Die wichtigste Zone ist 61,8 % (Golden Ratio, gelb).</>,
      <>C = der Punkt, an dem der Rücksetzer endet und der Kurs wieder dreht. Mit den Buttons setzt du C auf eine Fib-Stufe.</>,
      <>Die Extension-Tabelle zeigt zuerst die reine Formel aus den Quellen (Faktor × Impulsspanne, z. B. 1,618 × 50 $ = 80,90 $) und dann das Kursziel: diese Strecke wird ab C abgetragen, wie beim Trend-based-Fib-Extension-Werkzeug in TradingView. Bei Abwärtsbewegungen wird nach unten abgetragen.</>,
    ],
    example: (
      <>
        Impuls von 100 $ (A) auf 150 $ (B) = 50 $. Rücksetzer auf 61,8 % → C = 119,10 $. Ziel 1,618: 119,10 + 1,618 × 50 = <strong>200,00 $</strong>.
      </>
    ),
    tip: <>Fib-Stufen sind Zonen, keine exakten Preise. Am stärksten sind sie, wenn sie mit anderen Marken (Unterstützung, Orderblock) zusammenfallen.</>,
  },
  leverage: {
    what: (
      <>
        Mit Hebel bewegst du eine große Position mit wenig eigenem Geld. Die <strong>Margin</strong> ist der Teil, den du selbst hinterlegst.
        Wichtig: Der Hebel ändert nicht dein Risiko – das bestimmt allein der Stop-Loss und die Positionsgröße.
      </>
    ),
    steps: [
      <>Positionswert eintragen (Menge × Preis) – oder mit „aus Rechner 1“ übernehmen.</>,
      <>Hebel einstellen. Margin = Positionswert ÷ Hebel.</>,
      <>Liquidationspreis prüfen: Er muss weiter weg liegen als dein Stop-Loss. Sonst erscheint eine rote Warnung.</>,
    ],
    example: (
      <>
        Position 29.000 $ mit 20x Hebel: 29.000 ÷ 20 = <strong>1.450 $</strong> eigenes Kapital. Bei 20x reicht aber schon eine Gegenbewegung von
        etwa 5 % für die Liquidation.
      </>
    ),
    tip: <>Nimm nur so viel Hebel, dass der Stop-Loss sicher vor der Liquidation ausgelöst wird.</>,
  },
};

export function HelpBody({ help }: { help: Help }) {
  return (
    <div className="calc-help-body">
      <p>{help.what}</p>
      <div className="calc-help-label">So wendest du es an</div>
      <ol>
        {help.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      <div className="calc-help-label">Beispiel</div>
      <p>{help.example}</p>
      {help.tip && <p className="calc-help-tip">💡 {help.tip}</p>}
    </div>
  );
}
