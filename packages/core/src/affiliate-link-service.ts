import { assertCan, IgleError, type Actor } from "@igle/shared";
import { JsonStateStore } from "./state-store.js";
import type { SiteRecord } from "./types.js";

const COUNTRY_PATTERN = /^[a-z]{2}$/i;

/**
 * Where traffic should go, per country (administrator-set) — and, per site, an optional override
 * that takes priority (see resolveForSite). Resolved once by DeployService right before each
 * Deploy and baked directly into that build's click-redirect script (see @igle/build's
 * bakeAffiliateLinks) — deliberately not looked up live at click time: routing a real visitor's
 * click through the CMS's own server would tie every managed site's traffic back to one shared,
 * fingerprintable origin (see IGLE-14). The trade-off is that changing either the country default
 * or a site's override only takes effect on that site's *next Deploy*, not instantly.
 */
export class AffiliateLinkService {
  constructor(private readonly stateStore: JsonStateStore) {}

  async list(actor: Actor): Promise<Record<string, string>> {
    assertCan(actor, "integrations.configure");
    const state = await this.stateStore.read();
    return { ...state.affiliateLinks };
  }

  /**
   * The actual click destination for this site's cloaked CTAs: its own override if set, else the
   * country-level default for `site.metadata.country`, else undefined (no destination configured —
   * callers should fail safe, not throw). No `actor`/permission check: called internally by
   * DeployService during a build, not from a request a user makes directly.
   */
  async resolveForSite(site: SiteRecord): Promise<string | undefined> {
    const override = site.metadata.affiliateLinkOverride?.trim();
    if (override) return override;
    const country = site.metadata.country?.trim().toUpperCase();
    if (!country) return undefined;
    const state = await this.stateStore.read();
    return state.affiliateLinks?.[country];
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
