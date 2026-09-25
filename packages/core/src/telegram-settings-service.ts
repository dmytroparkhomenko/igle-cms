import { assertCan, IgleError, type Actor } from "@igle/shared";
import { JsonStateStore } from "./state-store.js";

// A real bot token from @BotFather, e.g. "123456789:AAFdcm-example-token-shape". Loosely
// validated (shape only, not a live check) — testConnection on TelegramProvider is what actually
// confirms it authenticates.
const BOT_TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]{30,}$/;

/** The one shared Telegram bot token used for task-assignment notifications — admin-set on /integrations, read by TelegramNotifier. */
export class TelegramSettingsService {
  constructor(private readonly stateStore: JsonStateStore) {}

  async get(actor: Actor): Promise<{ botToken?: string | undefined }> {
    assertCan(actor, "integrations.configure");
    const state = await this.stateStore.read();
    return { botToken: state.telegramBotToken };
  }

  async set(botToken: string, actor: Actor): Promise<void> {
    assertCan(actor, "integrations.configure");
    const trimmed = botToken.trim();
    if (trimmed && !BOT_TOKEN_PATTERN.test(trimmed)) {
      throw new IgleError("INVALID_TELEGRAM_TOKEN", 'That doesn\'t look like a Telegram bot token — it should look like "123456789:AA...".', 400);
    }
    await this.stateStore.update((state) => {
      if (trimmed) {
        state.telegramBotToken = trimmed;
      } else {
        delete state.telegramBotToken;
      }
    });
  }
}
