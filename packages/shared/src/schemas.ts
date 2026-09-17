import { z } from "zod";

export const urlStyleSchema = z.enum(["html-ext", "clean", "clean-slash"]);
export const wwwModeSchema = z.enum(["non-www", "www"]);
export const siteStatusSchema = z.enum(["draft", "published", "archived"]);
export const sourceTypeSchema = z.enum(["import", "template", "duplicate", "blank"]);

export const fieldStateSchema = z.enum(["inherited", "explicit", "manual-source", "absent", "ambiguous"]);
export type FieldState = z.infer<typeof fieldStateSchema>;

export const seoLimitsSchema = z.object({
  titleMin: z.number().int().nonnegative().default(30),
  titleMax: z.number().int().positive().default(60),
  descriptionMin: z.number().int().nonnegative().default(70),
  descriptionMax: z.number().int().positive().default(160)
});

export const siteMetadataSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  domain: z.string().optional(),
  alternateDomains: z.array(z.string()).default([]),
  brandName: z.string().optional(),
  country: z.string().optional(),
  region: z.string().optional(),
  city: z.string().optional(),
  language: z.string().length(2).default("en"),
  locale: z.string().min(2).default("en-US"),
  urlStyle: urlStyleSchema.default("clean"),
  wwwMode: wwwModeSchema.default("non-www"),
  https: z.boolean().default(true),
  deploymentTarget: z.enum(["local", "aapanel"]).default("local"),
  /** Which registered ServerRecord this site deploys to when deploymentTarget is "aapanel". */
  serverId: z.string().optional(),
  status: siteStatusSchema.default("draft"),
  sourceType: sourceTypeSchema,
  templateKey: z.string().optional(),
  templateVersion: z.string().optional(),
  duplicatedFromSiteId: z.string().optional(),
  duplicatedFromRevisionId: z.string().optional(),
  seoLimits: seoLimitsSchema.default({
    titleMin: 30,
    titleMax: 60,
    descriptionMin: 70,
    descriptionMax: 160
  }),
  sitemap: z
    .object({
      enabled: z.boolean().default(true),
      defaultChangefreq: z.string().optional(),
      defaultPriority: z.number().min(0).max(1).optional()
    })
    .default({ enabled: true }),
  robots: z
    .object({
      mode: z.enum(["cms-generated", "manual"]).default("cms-generated"),
      content: z.string().optional()
    })
    .default({ mode: "cms-generated" }),
  /** Site-wide default for the <meta name="robots"> tag, injected at build time into any page that doesn't already set its own. */
  metaRobots: z.enum(["index", "noindex"]).default("index"),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type SiteMetadata = z.infer<typeof siteMetadataSchema>;

export const pageFieldStatesSchema = z.object({
  seoTitle: fieldStateSchema.default("absent"),
  metaDescription: fieldStateSchema.default("absent"),
  h1: fieldStateSchema.default("absent"),
  canonical: fieldStateSchema.default("absent"),
  robots: fieldStateSchema.default("absent"),
  ogTitle: fieldStateSchema.default("absent"),
  ogDescription: fieldStateSchema.default("absent")
});

export const pageMetadataSchema = z.object({
  id: z.string().min(1),
  filePath: z.string().min(1),
  route: z.string().min(1),
  internalName: z.string().min(1),
  pageType: z.string().optional(),
  primaryKeyword: z.string().optional(),
  inSitemap: z.boolean().default(true),
  fieldStates: pageFieldStatesSchema.default({}),
  lastWrittenHashes: z.record(z.string()).default({}),
  deletedAt: z.string().optional(),
  trashPath: z.string().optional(),
  previousInSitemap: z.boolean().optional()
});

export type PageMetadata = z.infer<typeof pageMetadataSchema>;

export const pagesMetadataSchema = z.object({
  pages: z.array(pageMetadataSchema)
});

export type PagesMetadata = z.infer<typeof pagesMetadataSchema>;

export const redirectsMetadataSchema = z.object({
  redirects: z.array(
    z.object({
      id: z.string(),
      from: z.string(),
      to: z.string(),
      status: z.enum(["301", "302"]).default("301")
    })
  )
});

export const scriptsMetadataSchema = z.object({
  scripts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      environment: z.enum(["preview", "production", "both"]),
      placement: z.enum(["head-start", "head-end", "body-start", "body-end"]),
      code: z.string(),
      enabled: z.boolean().default(true),
      pages: z
        .object({
          mode: z.enum(["all", "selected", "patterns"]).default("all"),
          paths: z.array(z.string()).default([]),
          patterns: z.array(z.string()).default([])
        })
        .default({ mode: "all", paths: [], patterns: [] }),
      owner: z.string().optional()
    })
  )
});

export const verificationsMetadataSchema = z.object({
  verifications: z.array(
    z.object({
      id: z.string(),
      provider: z.enum(["google", "bing", "generic"]),
      filePath: z.string().optional(),
      metaName: z.string().optional(),
      contentHash: z.string()
    })
  )
});

export const variablesMetadataSchema = z.object({
  variables: z.record(z.string())
});

export const emptyProjectMetadata = {
  pages: { pages: [] },
  redirects: { redirects: [] },
  scripts: { scripts: [] },
  verifications: { verifications: [] },
  variables: { variables: {} }
};

export function validateSiteMetadata(value: unknown): SiteMetadata {
  return siteMetadataSchema.parse(value);
}

export function validatePagesMetadata(value: unknown): PagesMetadata {
  return pagesMetadataSchema.parse(value);
}
