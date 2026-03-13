import { describe, test, expect } from 'vitest';
import { matchFiles, groupMatchResults } from './matcher.ts';

const cwd = '/project';
const files = ['/project/src/index.ts', '/project/src/utils.js', '/project/README.md'];

describe('matchFiles', () => {
  test('matches TypeScript files with regex', () => {
    const results = matchFiles(files, '\\.ts$', cwd);
    expect(results.map((r) => r.file)).toEqual(['/project/src/index.ts']);
  });

  test('matches multiple extensions with alternation', () => {
    const results = matchFiles(files, '\\.(ts|js)$', cwd);
    expect(results.map((r) => r.file)).toEqual(['/project/src/index.ts', '/project/src/utils.js']);
  });

  test('returns empty for no matches', () => {
    expect(matchFiles(files, '\\.css$', cwd)).toEqual([]);
  });

  test('excludes files matching exclude pattern', () => {
    const allFiles = ['/project/src/index.ts', '/project/src/index.test.ts'];
    const results = matchFiles(allFiles, '\\.ts$', cwd, '**/*.test.ts');
    expect(results.map((r) => r.file)).toEqual(['/project/src/index.ts']);
  });

  test('captures named groups', () => {
    const wsFiles = ['/project/packages/app/src/index.ts'];
    const results = matchFiles(wsFiles, '^packages/(?<workspace>[^/]+)/.*\\.ts$', cwd);
    expect(results).toHaveLength(1);
    expect(results[0]?.groups).toEqual({ workspace: 'app' });
  });
});

describe('groupMatchResults', () => {
  test('groups by named capture group values', () => {
    const wsFiles = [
      '/project/packages/app/src/a.ts',
      '/project/packages/app/src/b.ts',
      '/project/packages/lib/src/c.ts',
    ];
    const results = matchFiles(wsFiles, '^packages/(?<workspace>[^/]+)/.*\\.ts$', cwd);
    const grouped = groupMatchResults(results);

    expect(grouped.size).toBe(2);
    expect(grouped.get('app')?.files).toEqual([
      '/project/packages/app/src/a.ts',
      '/project/packages/app/src/b.ts',
    ]);
    expect(grouped.get('lib')?.files).toEqual(['/project/packages/lib/src/c.ts']);
  });

  test('uses empty string key when no named groups', () => {
    const results = matchFiles(files, '\\.ts$', cwd);
    const grouped = groupMatchResults(results);
    expect(grouped.size).toBe(1);
    expect(grouped.get('')?.files).toEqual(['/project/src/index.ts']);
  });
});
