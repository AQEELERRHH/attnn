/**
 * Creator profile rules shared by the profile routes. Client-safe (no server imports).
 *
 * Tags are written to the AttnnRegistry on Arc as well as the DB, and the registry
 * rejects more than 10 tags and matches them exactly (getCreatorsByTag("ai") won't
 * find "AI"), so tags are trimmed, lower-cased and de-duplicated before saving.
 */
export const MAX_TAGS = 10;
export const MAX_TAG_CHARS = 32;

export function normalizeTags(input: unknown): { ok: true; tags: string[] } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true, tags: [] };
  if (!Array.isArray(input) || input.some((t) => typeof t !== "string")) {
    return { ok: false, error: "Tags must be a list of words" };
  }
  const seen = new Set<string>();
  for (const raw of input as string[]) {
    const tag = raw.trim().toLowerCase();
    if (!tag) continue;
    if (tag.length > MAX_TAG_CHARS) return { ok: false, error: `Tags can be at most ${MAX_TAG_CHARS} characters ("${tag.slice(0, 12)}…")` };
    seen.add(tag);
  }
  if (seen.size > MAX_TAGS) return { ok: false, error: `Use at most ${MAX_TAGS} tags` };
  return { ok: true, tags: [...seen] };
}
