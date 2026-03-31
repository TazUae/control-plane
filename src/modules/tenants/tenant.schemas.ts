import { z } from "zod";
import { normalizeSlug, SLUG_SITE_REGEX } from "../../lib/validation.js";

export const CreateTenantSchema = z.object({
  slug: z
    .string()
    .trim()
    .transform((value) => normalizeSlug(value))
    .refine((value) => SLUG_SITE_REGEX.test(value), {
      message: "slug must match ^[a-z0-9-]+(\\.[a-z0-9-]+)*$",
    }),
  plan: z.string().trim().min(1).max(64).default("pro"),
  region: z.string().trim().min(1).max(32).default("eu"),
});

export type CreateTenantInput = z.infer<typeof CreateTenantSchema>;
