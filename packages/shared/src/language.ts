/**
 * The value written into <html lang> when a page follows the site default: language alone
 * ("es"), or language-COUNTRY ("es-MX") once a GEO is configured — matching real BCP-47 usage.
 */
export function effectiveSiteLanguageTag(metadata: { language: string; country?: string | undefined }): string {
  const language = metadata.language.toLowerCase();
  return metadata.country ? `${language}-${metadata.country.toUpperCase()}` : language;
}

/**
 * Real pages commonly use a full locale for <html lang> (e.g. "es-MX", "en-US"). Comparing
 * only the primary subtag on both sides means a page still counts as following the site's
 * language regardless of region — either side may or may not carry one — and only a genuinely
 * different primary language (e.g. page "en" vs site "es"/"es-MX") counts as an override.
 */
export function matchesSiteLanguage(pageLang: string | undefined, siteLanguage: string): boolean {
  if (pageLang === undefined) return false;
  const pagePrimary = pageLang.split("-")[0]?.toLowerCase();
  const sitePrimary = siteLanguage.split("-")[0]?.toLowerCase();
  return Boolean(pagePrimary) && pagePrimary === sitePrimary;
}
