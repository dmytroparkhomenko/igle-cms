import { z } from "zod";

export const templateManifestSchema = z.object({
  key: z.string().min(1),
  version: z.string().min(1),
  name: z.string().min(1),
  pageTypes: z.array(
    z.object({
      key: z.string().min(1),
      name: z.string().min(1),
      file: z.string().min(1),
      fields: z.array(
        z.object({
          key: z.string().min(1),
          type: z.enum(["text", "rich-text", "image", "link"]),
          selector: z.string().min(1)
        })
      )
    })
  )
});

export type TemplateManifest = z.infer<typeof templateManifestSchema>;

export function validateTemplateManifest(value: unknown): TemplateManifest {
  return templateManifestSchema.parse(value);
}
