import type Anthropic from "@anthropic-ai/sdk";
import type { Effort, TurnEvent } from "../../shared/claudeTurn";
import { STANDALONE, claudeSettings } from "../config";

type MessageParam = Anthropic.Beta.BetaMessageParam;

/** Runs one Claude turn and reports its events; via the Node server, or directly in standalone builds. */
export async function runTurn(messages: MessageParam[], effort: Effort, signal: AbortSignal, emit: (e: TurnEvent) => void): Promise<void> {
  if (STANDALONE) return runDirect(messages, effort, signal, emit);

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, effort }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Server-Fehler ${res.status}: ${await res.text()}`);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (chunk.startsWith("data: ")) emit(JSON.parse(chunk.slice(6)) as TurnEvent);
    }
  }
}

async function runDirect(messages: MessageParam[], effort: Effort, signal: AbortSignal, emit: (e: TurnEvent) => void) {
  const { apiKey, model } = claudeSettings.get();
  if (!apiKey) {
    emit({ type: "error", message: "Kein API-Schlüssel hinterlegt. Tippe oben im Claude-Panel auf ⚙ und trage deinen Schlüssel ein." });
    return;
  }
  // Loaded on demand so server builds don't ship the SDK to the browser.
  const [{ default: AnthropicSDK }, { runClaudeTurn }] = await Promise.all([import("@anthropic-ai/sdk"), import("../../shared/claudeTurn")]);
  // The key is the user's own and never leaves this device except to api.anthropic.com.
  const client = new AnthropicSDK({ apiKey, dangerouslyAllowBrowser: true });
  await runClaudeTurn(client, { model, messages, effort, authHint: "API-Schlüssel ungültig. Prüfe ihn unter ⚙ im Claude-Panel." }, emit, signal);
}
