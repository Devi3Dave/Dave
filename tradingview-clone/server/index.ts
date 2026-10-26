import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import { z } from "zod";
import { DEFAULT_MODEL, runClaudeTurn, type TurnEvent } from "../shared/claudeTurn.js";
import { loadMarketData, loadOpenInterest } from "../shared/marketData.js";

try {
  process.loadEnvFile(".env");
} catch {
  // no .env file - rely on the environment
}

const PORT = Number(process.env.PORT ?? 8787);
const MODEL = process.env.CLAUDE_MODEL ?? DEFAULT_MODEL;

const client = new Anthropic();
const app = express();
app.use(express.json({ limit: "50mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, model: MODEL, apiKey: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) });
});

app.get("/api/klines", async (req, res) => {
  const symbol = String(req.query.symbol ?? "BTCUSDT");
  const interval = String(req.query.interval ?? "1h");
  const limit = Math.min(1000, Math.max(50, Number(req.query.limit ?? 1000)));
  const endTime = req.query.endTime ? Number(req.query.endTime) : undefined;
  try {
    res.json(await loadMarketData(symbol, interval, limit, endTime && Number.isFinite(endTime) ? endTime : undefined));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.get("/api/open-interest", async (req, res) => {
  try {
    res.json(await loadOpenInterest(String(req.query.symbol ?? "BTCUSDT"), String(req.query.period ?? "1h"), Number(req.query.limit ?? 500)));
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

const ChatRequest = z.object({
  // History is passed through unchanged (thinking blocks included); the API validates it.
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.unknown() })).min(1),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).default("high"),
});

app.post("/api/chat", async (req, res) => {
  const parsed = ChatRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { messages, effort } = parsed.data;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  const abort = new AbortController();
  res.on("close", () => abort.abort());
  const send = (event: TurnEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  await runClaudeTurn(
    client,
    {
      model: MODEL,
      messages: messages as Anthropic.Beta.BetaMessageParam[],
      effort,
      authHint: "Kein gültiger API-Schlüssel. Setze ANTHROPIC_API_KEY in tradingview-clone/.env.",
    },
    send,
    abort.signal,
  );
  res.end();
});

if (process.env.NODE_ENV === "production") {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT}  (Modell: ${MODEL})`);
});
