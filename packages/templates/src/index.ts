import nunjucks from "nunjucks";
import { z } from "zod";

export const templateFieldSchema = z.object({
  key: z.string().min(1),
  type: z.enum(["text", "rich-text", "image", "link"]),
  selector: z.string().min(1),
  label: z.string().optional(),
  default: z.string().optional()
});

export const templatePageTypeSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  file: z.string().min(1),
  route: z.string().min(1),
  seoTitle: z.string().optional(),
  metaDescription: z.string().optional(),
  fields: z.array(templateFieldSchema)
});

export const templateManifestSchema = z.object({
  key: z.string().min(1),
  version: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  pageTypes: z.array(templatePageTypeSchema).min(1)
});

export type TemplateField = z.infer<typeof templateFieldSchema>;
export type TemplatePageType = z.infer<typeof templatePageTypeSchema>;
export type TemplateManifest = z.infer<typeof templateManifestSchema>;

export function validateTemplateManifest(value: unknown): TemplateManifest {
  return templateManifestSchema.parse(value);
}

export interface RenderPageInput {
  site: { name: string; locale: string; language: string };
  page: { seoTitle: string; metaDescription: string };
  fields: Record<string, string>;
}

const nunjucksEnv = new nunjucks.Environment(null, { autoescape: true });

/**
 * "text"/"link" fields render auto-escaped (safe default for plain values); a template marks a
 * "rich-text" field's placeholder with the `| safe` filter where it intentionally contains HTML
 * (see templates/affiliate-review's pros/cons lists) rather than this function guessing per-key.
 */
export function renderTemplateHtml(source: string, input: RenderPageInput): string {
  return nunjucksEnv.renderString(source, input);
}
