import { TelegramProvider } from "@igle/deployer";
import { JsonStateStore } from "./state-store.js";

export interface TelegramPing {
  userId: string;
  taskId: string;
  message: string;
}

/**
 * Fires task-notification pings to Telegram — the delivery side of TaskService's TaskPingDelivery
 * collaborator (see task-service.ts). Deliberately has no dependency on task-service.ts or
 * auth-service.ts; it just reads state directly and sends. Every failure mode here (no bot token
 * set, no recipient chat ID, a live send failing) is a silent no-op or a swallowed warning — a
 * Telegram outage must never surface as an error to whoever performed the task action, and the
 * in-app NotificationRecord (written separately, unconditionally) is always the source of truth.
 */
export class TelegramNotifier {
  constructor(
    private readonly stateStore: JsonStateStore,
    private readonly webOrigin: string
  ) {}

  async deliver(pings: TelegramPing[]): Promise<void> {
    if (pings.length === 0) return;
    try {
      const state = await this.stateStore.read();
      const botToken = state.telegramBotToken;
      if (!botToken) return;

      const provider = new TelegramProvider({ botToken });
      for (const ping of pings) {
        const user = state.users.find((item) => item.id === ping.userId);
        if (!user?.telegramChatId) continue;
        const result = await provider.sendMessage(user.telegramChatId, ping.message, `${this.webOrigin}/tasks/${ping.taskId}`);
        if (!result.ok) {
          console.warn(`Telegram send failed for user ${ping.userId}: ${result.error}`);
        }
      }
    } catch (error) {
      console.warn("Telegram notification delivery failed:", error);
    }
  }
}
