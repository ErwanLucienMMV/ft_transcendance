/**
 * Nonblank text of at most 2000 Unicode code points, as PostgreSQL varchar counts them.
 * In Unicode regex mode the range matches only unpaired surrogates; valid pairs, including
 * emoji, are single code points.
 */
export function isMessageContent(content: unknown): content is string {
  return (
    typeof content === 'string' &&
    !!content.trim() &&
    Array.from(content).length <= 2000 &&
    !content.includes('\0') &&
    !/[\uD800-\uDFFF]/u.test(content)
  );
}
