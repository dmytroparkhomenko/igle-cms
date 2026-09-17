import { assertCan, IgleError, type Actor } from "@igle/shared";
import { JsonStateStore } from "./state-store.js";

const COUNTRY_PATTERN = /^[a-z]{2}$/i;

/**
 * Where traffic should go, per country — administrator-set, storage only for now. Nothing in
 * the build/deploy/render pipeline reads or applies these to site content yet; this exists so
 * the value has a durable, access-controlled home while that decision is made separately.
 */
export class AffiliateLinkService {
  constructor(private readonly stateStore: JsonStateStore) {}

  async list(actor: Actor): Promise<Record<string, string>> {
    assertCan(actor, "integrations.configure");
    const state = await this.stateStore.read();
    return { ...state.affiliateLinks };
  }

  async set(country: string, url: string, actor: Actor): Promise<void> {
    assertCan(actor, "integrations.configure");
    const code = country.trim().toUpperCase();
    if (!COUNTRY_PATTERN.test(code)) {
      throw new IgleError("INVALID_COUNTRY", "Country must be a 2-letter ISO 3166-1 code, e.g. BR.", 400, { country });
    }
    const trimmedUrl = url.trim();
    if (trimmedUrl && !/^https?:\/\/.+/i.test(trimmedUrl)) {
      throw new IgleError("INVALID_URL", "Enter a full URL starting with http:// or https://.", 400, { url });
    }

    await this.stateStore.update((state) => {
      state.affiliateLinks ??= {};
      if (trimmedUrl) {
        state.affiliateLinks[code] = trimmedUrl;
      } else {
        delete state.affiliateLinks[code];
      }
    });
  }
}
