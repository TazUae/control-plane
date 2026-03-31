const SLUG_SITE_REGEX = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;

export function normalizeSlug(input: string): string {
  return input.trim().toLowerCase();
}

export function assertValidSlugOrSite(value: string, fieldName: string): void {
  if (!SLUG_SITE_REGEX.test(value)) {
    throw new Error(`Invalid ${fieldName} format`);
  }
}

export { SLUG_SITE_REGEX };
