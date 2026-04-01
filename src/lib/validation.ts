const SLUG_SITE_REGEX = /^[a-z0-9-]+$/;
const SLUG_SITE_MIN_LENGTH = 3;
const SLUG_SITE_MAX_LENGTH = 63;

export function normalizeSlug(input: string): string {
  return input.trim().toLowerCase();
}

export function assertValidSlugOrSite(value: string, fieldName: string): void {
  if (value.length < SLUG_SITE_MIN_LENGTH || value.length > SLUG_SITE_MAX_LENGTH) {
    throw new Error(
      `Invalid ${fieldName} length, expected ${SLUG_SITE_MIN_LENGTH}-${SLUG_SITE_MAX_LENGTH} chars`
    );
  }
  if (!SLUG_SITE_REGEX.test(value)) {
    throw new Error(`Invalid ${fieldName} format, expected lowercase letters, digits, hyphens`);
  }
}

export { SLUG_SITE_REGEX, SLUG_SITE_MIN_LENGTH, SLUG_SITE_MAX_LENGTH };
