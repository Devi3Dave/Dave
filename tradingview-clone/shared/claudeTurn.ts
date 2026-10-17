// One streamed Claude turn, shared by the Node server (SSE proxy) and the
// standalone browser build (direct API calls with the user's own key).
import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_MODEL } from "./models.js";
import { SYSTEM_PROMPT } from "./prompt.js";
import { toolDefinitions } from "./tools.js";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface FinalMessage {
  content: Anthropic.Beta.BetaContentBlock[];
  stop_reason: string | null;
  stop_details?: { category?: string | null; explanation?: string | null } | null;
  model?: string;
  usage?: unknown;
}

export type TurnEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "thinking_start" }
  | { type: "tool_start"; id: string; name: string }
  | { type: "reset" }
  | { type: "final"; message: FinalMessage }
  | { type: "error"; message: string; status?: number };

export { DEFAULT_MODEL };
// Models that accept server-side refusal fallbacks (`fallbacks: "default"`).
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);
const TOOLS = toolDefinitions();

export async function runClaudeTurn(
  client: Anthropic,
  opts: { model: string; messages: Anthropic.Beta.BetaMessageParam[]; effort: Effort; authHint: string },
  send: (event: TurnEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  for (let attempt = 0; attempt < 3 && !signal?.aborted; attempt++) {
    let sawToolUse = false;
    try {
      const stream = client.beta.messages.stream(
        {
          model: opts.model,
          max_tokens: 64000,
          system: [{ type: "text", text: SYSTEM_PROMPT }],
          tools: TOOLS,
          messages: opts.messages,
          thinking: { type: "adaptive", display: "summarized" },
          output_config: { effort: opts.effort },
          cache_control: { type: "ephemeral" },
          ...(FALLBACK_MODELS.has(opts.model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        },
        { signal },
      );

      for await (const event of stream) {
        if (event.type === "content_block_start") {
          const block = event.content_block;
          if (block.type === "tool_use") {
            sawToolUse = true;
            send({ type: "tool_start", id: block.id, name: block.name });
          } else if (block.type === "thinking") send({ type: "thinking_start" });
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
      return;
    } catch (err) {
      if (signal?.aborted) return;
      if (err instanceof Anthropic.APIError) {
        const message =
          err instanceof Anthropic.AuthenticationError
            ? opts.authHint
            : err instanceof Anthropic.RateLimitError
              ? "Rate-Limit erreicht, bitte kurz warten."
              : err.message;
        send({ type: "error", status: err.status, message });
        return;
      }
      // With eager input streaming a tool input can arrive as unparseable JSON
      // and the SDK rejects the stream. Only that case (a non-API error after a
      // tool_use block started) is re-issued; the client drops the partial turn.
      const message = (err as Error).message;
      console.warn(`[claude] attempt ${attempt + 1} failed: ${message}`);
      if (!sawToolUse || attempt === 2) {
        send({ type: "error", message });
        return;
      }
      send({ type: "reset" });
    }
  }
}
