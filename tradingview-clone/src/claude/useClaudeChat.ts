import type Anthropic from "@anthropic-ai/sdk";
import { useCallback, useRef, useState } from "react";
import type { ChartEngine } from "../chart/ChartEngine";
import { store } from "../store";
import { buildChartState } from "./context";
import { executeTool } from "./executor";

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentBlock = Anthropic.Beta.BetaContentBlock;

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type AssistantPart =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; id: string; name: string; status: "running" | "done" | "error"; summary?: string }
  | { type: "notice"; text: string; level: "info" | "error" };

export type ChatItem =
  | { role: "user"; text: string; image?: string }
  | { role: "assistant"; parts: AssistantPart[]; streaming: boolean };

interface FinalMessage {
  content: ContentBlock[];
  stop_reason: string | null;
  stop_details?: { category?: string | null; explanation?: string | null } | null;
}

const MAX_TURNS = 25;

/** Streams one model turn from the server; returns the final message or throws. */
async function streamTurn(
  messages: MessageParam[],
  effort: Effort,
  signal: AbortSignal,
  on: { text: (t: string) => void; thinking: (t: string) => void; toolStart: (id: string, name: string) => void; reset: () => void },
): Promise<FinalMessage> {
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
    if (done) break;
    buffer += value;
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (!chunk.startsWith("data: ")) continue;
      const event = JSON.parse(chunk.slice(6));
      switch (event.type) {
        case "text":
          on.text(event.text);
          break;
        case "thinking":
          on.thinking(event.text);
          break;
        case "tool_start":
          on.toolStart(event.id, event.name);
          break;
        case "reset":
          on.reset();
          break;
        case "final":
          return event.message as FinalMessage;
        case "error":
          throw new Error(event.message);
      }
    }
  }
  throw new Error("Verbindung zum Server unterbrochen.");
}

export function useClaudeChat(getEngine: () => ChartEngine | null) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [busy, setBusy] = useState(false);
  const history = useRef<MessageParam[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (text: string, opts: { effort: Effort; screenshot: boolean }) => {
      if (busy || !text.trim()) return;
      const engine = getEngine();
      const image = opts.screenshot && engine ? engine.screenshot() : undefined;

      const content: Anthropic.Beta.BetaContentBlockParam[] = [{ type: "text", text: buildChartState(store.get(), engine) }];
      if (image) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: image.split(",")[1] } });
      content.push({ type: "text", text });
      history.current.push({ role: "user", content });

      // Parts of the assistant reply, mirrored into React state on every change.
      let parts: AssistantPart[] = [];
      const render = (streaming = true) =>
        setItems((prev) => [...prev.slice(0, -1), { role: "assistant", parts, streaming }]);
      const update = (next: AssistantPart[]) => {
        parts = next;
        render();
      };
      const appendDelta = (type: "text" | "thinking", delta: string) => {
        const last = parts[parts.length - 1];
        update(last && last.type === type ? [...parts.slice(0, -1), { ...last, text: last.text + delta }] : [...parts, { type, text: delta }]);
      };
      const notice = (level: "info" | "error", msg: string) => update([...parts, { type: "notice", level, text: msg }]);

      setItems((prev) => [...prev, { role: "user", text, image }, { role: "assistant", parts: [], streaming: true }]);
      setBusy(true);
      const abort = new AbortController();
      abortRef.current = abort;

      try {
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const turnStart = parts.length;
          const message = await streamTurn(history.current, opts.effort, abort.signal, {
            text: (t) => appendDelta("text", t),
            thinking: (t) => appendDelta("thinking", t),
            toolStart: (id, name) => update([...parts, { type: "tool", id, name, status: "running" }]),
            // The server re-issues a turn whose tool input could not be parsed.
            reset: () => update(parts.slice(0, turnStart)),
          });
          // Pass the content back unchanged (thinking blocks included).
          history.current.push({ role: "assistant", content: message.content as MessageParam["content"] });

          if (message.stop_reason === "refusal") {
            const why = message.stop_details?.explanation ?? message.stop_details?.category ?? "";
            notice("error", `Claude hat die Anfrage abgelehnt. ${why}`);
            break;
          }
          if (message.stop_reason === "pause_turn") continue;

          const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
          if (toolUses.length === 0) {
            if (message.stop_reason === "max_tokens") notice("info", "Antwort wurde wegen Längenlimit abgeschnitten.");
            break;
          }

          const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
          for (const tu of toolUses) {
            // A turn cut off at max_tokens may carry a truncated tool input - don't run it.
            const outcome =
              message.stop_reason === "max_tokens"
                ? { content: "Tool-Eingabe abgeschnitten (max_tokens), nicht ausgeführt.", isError: true, summary: "abgeschnitten" }
                : await executeTool(tu.name, tu.input, getEngine());
            results.push({ type: "tool_result", tool_use_id: tu.id, content: outcome.content, ...(outcome.isError ? { is_error: true } : {}) });
            const done: AssistantPart = { type: "tool", id: tu.id, name: tu.name, status: outcome.isError ? "error" : "done", summary: outcome.summary };
            const known = parts.some((p) => p.type === "tool" && p.id === tu.id);
            update(known ? parts.map((p) => (p.type === "tool" && p.id === tu.id ? done : p)) : [...parts, done]);
          }
          history.current.push({ role: "user", content: results });
          if (message.stop_reason === "max_tokens") break;
        }
      } catch (err) {
        if (!abort.signal.aborted) notice("error", (err as Error).message);
      } finally {
        render(false);
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, getEngine],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    history.current = [];
    setItems([]);
  }, []);

  return { items, busy, send, stop, reset };
}
