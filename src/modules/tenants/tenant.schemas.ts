import { z } from "zod";
import {
  normalizeSlug,
  SLUG_SITE_MAX_LENGTH,
  SLUG_SITE_MIN_LENGTH,
  SLUG_SITE_REGEX,
} from "../../lib/validation.js";

export const GetTenantParamsSchema = z.object({
  id: z.string().uuid(),
});

export type GetTenantParams = z.infer<typeof GetTenantParamsSchema>;

export const CreateTenantSchema = z.object({
  slug: z
    .string()
    .trim()
    .transform((value) => normalizeSlug(value))
    .refine((value) => value.length >= SLUG_SITE_MIN_LENGTH && value.length <= SLUG_SITE_MAX_LENGTH, {
      message: `slug length must be ${SLUG_SITE_MIN_LENGTH}-${SLUG_SITE_MAX_LENGTH}`,
    })
    .refine((value) => SLUG_SITE_REGEX.test(value), {
      message: "slug must match ^[a-z0-9-]+$",
    }),
  plan: z.string().trim().min(1).max(64).default("pro"),
  region: z.string().trim().min(1).max(32).default("eu"),
});

export type CreateTenantInput = z.infer<typeof CreateTenantSchema>;
