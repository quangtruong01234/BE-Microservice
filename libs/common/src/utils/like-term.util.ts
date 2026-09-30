/**
 * Neutralize the SQL LIKE wildcards in user input so a search box typed with
 * `_` or `%` gets a literal match instead of a wildcard scan. MySQL's default
 * LIKE escape character is a backslash, so no ESCAPE clause is needed
 * (TypeORM's `Like()` does not emit one). MySQL only — Node B is PostgreSQL.
 */
export const escapeLikeTerm = (term: string): string =>
  term.replace(/[\\%_]/g, (character) => `\\${character}`);

/**
 * `%term%` for a substring LIKE, or `null` when the trimmed input is blank —
 * a blank search box means "no filter", never "match the empty string".
 */
export const toContainsLikePattern = (
  term: string | null | undefined,
): string | null => {
  const trimmed = term?.trim();
  return trimmed ? `%${escapeLikeTerm(trimmed)}%` : null;
};
