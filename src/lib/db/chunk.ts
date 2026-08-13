/**
 * Split a list of values into fixed-size chunks (default 100).
 *
 * PostgREST renders a `.in("col", values)` filter into the request URL, so a
 * single call carrying a very large membership population (hundreds of ids) can
 * exceed the URL/request-line limit and come back as a Bad Request — which is
 * what took down `/api/company-members` and `/api/messages/users` for the
 * largest companies. Callers loop over these chunks and accumulate rows so every
 * request stays bounded regardless of company size.
 *
 * Chunks preserve input order and partition the input exactly: every value
 * appears in exactly one chunk, so accumulating results across chunks never
 * duplicates or drops a value (including at chunk boundaries).
 */
export const chunkValues = <T>(values: readonly T[], size = 100): T[][] => {
  const safeSize = Number.isFinite(size) && size > 0 ? Math.floor(size) : 100;
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += safeSize) {
    chunks.push(values.slice(index, index + safeSize));
  }
  return chunks;
};
