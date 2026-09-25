const API_BASE = "https://api.telegram.org";

export interface TelegramConfig {
  botToken: string;
}

export class TelegramError extends Error {
  public readonly raw: unknown;

  constructor(message: string, raw?: unknown) {
    super(message);
    this.name = "TelegramError";
    this.raw = raw;
  }
}

interface TelegramEnvelope<T> {
  ok: boolean;
  description?: string;
  error_code?: number;
  result?: T;
}

/**
 * Talks to a real Telegram bot over its standard Bot API (api.telegram.org/bot<token>/<method>).
 * Mirrors CloudflareProvider/VultrProvider's shape — one call() wrapper over the {ok, result}
 * envelope every method shares. Only sendMessage is implemented: this is a fire-and-forget
 * notification channel, not a full bot integration, so there's no inbound webhook/polling here —
 * a user obtains their own chat ID by some external means (e.g. messaging @userinfobot) and pastes
 * it into Igle CMS themselves.
 */
export class TelegramProvider {
  constructor(private readonly config: TelegramConfig) {}

  /** Never throws — this is used fire-and-forget from a task-notification path that must never fail the underlying task action. */
  async sendMessage(chatId: string, text: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.call("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Telegram send failed." };
    }
  }

  /** Read-only: confirms the token actually authenticates as a real bot. */
  async testConnection(): Promise<{ ok: boolean; botUsername?: string | undefined; error?: string }> {
    try {
      const me = await this.call<{ username?: string }>("getMe", {});
      return { ok: true, botUsername: me.username };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Connection test failed." };
    }
  }

  private async call<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${API_BASE}/bot${this.config.botToken}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000)
    });
    const text = await response.text();
    let json: TelegramEnvelope<T>;
    try {
      json = JSON.parse(text) as TelegramEnvelope<T>;
    } catch {
      throw new TelegramError(`Telegram returned a non-JSON response from ${method} (HTTP ${response.status}): ${text.slice(0, 200)}`);
    }
    if (!json.ok) {
      throw new TelegramError(json.description ?? `Telegram reported failure from ${method}.`, json);
    }
    return json.result as T;
  }
}
