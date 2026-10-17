import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import { z } from "zod";
import { toolDefinitions } from "../shared/tools.js";
import { loadMarketData } from "./marketData.js";
import { SYSTEM_PROMPT } from "./prompt.js";

try {
  process.loadEnvFile(".env");
} catch {
  // no .env file - rely on the environment
}

const PORT = Number(process.env.PORT ?? 8787);
const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
// Models that accept server-side refusal fallbacks (`fallbacks: "default"`).
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);
const TOOLS = toolDefinitions();

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
  try {
    res.json(await loadMarketData(symbol, interval, limit));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
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
  const send = (event: Record<string, unknown>) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  let current: { abort: () => void } | null = null;
  let sawToolUse = false;
  let closed = false;
  res.on("close", () => {
    closed = true;
    current?.abort();
  });

  for (let attempt = 0; attempt < 3 && !closed; attempt++) {
    try {
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 64000,
        system: [{ type: "text", text: SYSTEM_PROMPT }],
        tools: TOOLS,
        messages: messages as Anthropic.Beta.BetaMessageParam[],
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort },
        cache_control: { type: "ephemeral" },
        ...(FALLBACK_MODELS.has(MODEL) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });
      current = stream;
      sawToolUse = false;

      for await (const event of stream) {
        if (event.type === "content_block_start") {
          const block = event.content_block;
          if (block.type === "tool_use") {
            sawToolUse = true;
            send({ type: "tool_start", id: block.id, name: block.name });
          }
          else if (block.type === "thinking") send({ type: "thinking_start" });
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") send({ type: "text", text: event.delta.text });
          else if (event.delta.type === "thinking_delta") send({ type: "thinking", text: event.delta.thinking });
        }
      }
      const message = await stream.finalMessage();
      send({
        type: "final",
        message: {
          content: message.content,
          stop_reason: message.stop_reason,
          stop_details: message.stop_details,
          model: message.model,
          usage: message.usage,
        },
      });
      break;
    } catch (err) {
      if (closed) break;
      if (err instanceof Anthropic.APIError) {
        const hint =
          err instanceof Anthropic.AuthenticationError
            ? "Kein gültiger API-Schlüssel. Setze ANTHROPIC_API_KEY in tradingview-clone/.env."
            : err instanceof Anthropic.RateLimitError
              ? "Rate-Limit erreicht, bitte kurz warten."
              : err.message;
        send({ type: "error", status: err.status, message: hint });
        break;
      }
      // With eager input streaming a tool input can arrive as unparseable JSON
      // and the SDK rejects the stream. Only that case (a non-API error after a
      // tool_use block started) is re-issued; the client drops the partial turn.
      const message = (err as Error).message;
      console.warn(`[claude] attempt ${attempt + 1} failed: ${message}`);
      if (!sawToolUse || attempt === 2) {
        send({ type: "error", message });
        break;
      }
      send({ type: "reset" });
    }
  }
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
