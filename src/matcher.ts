import { matchesGlob, relative } from 'node:path';

export type MatchResult = {
  readonly file: string;
  readonly groups: Readonly<Record<string, string>>;
};

export const matchFiles = (
  files: readonly string[],
  match: string,
  cwd: string,
  exclude?: string,
): readonly MatchResult[] => {
  const matchRegex = new RegExp(match);

  const results: MatchResult[] = [];

  for (const file of files) {
    const rel = relative(cwd, file);
    if (exclude !== undefined && matchesGlob(rel, exclude)) continue;
    const m = matchRegex.exec(rel);
    if (!m) continue;

    const groups: Record<string, string> = {};
    if (m.groups) {
      for (const [key, value] of Object.entries(m.groups)) {
        if (value !== undefined) {
          groups[key] = value;
        }
      }
    }

    results.push({ file, groups });
  }

  return results;
};

// Group matched files by named capture group values
export const groupMatchResults = (
  results: readonly MatchResult[],
): ReadonlyMap<
  string,
  { readonly groups: Readonly<Record<string, string>>; readonly files: readonly string[] }
> => {
  const map = new Map<string, { groups: Readonly<Record<string, string>>; files: string[] }>();

  for (const result of results) {
    const keyParts = Object.values(result.groups);
    const key = keyParts.length > 0 ? keyParts.join('/') : '';

    const existing = map.get(key);
    if (existing) {
      existing.files.push(result.file);
    } else {
      map.set(key, { groups: result.groups, files: [result.file] });
    }
  }

  return map;
};
