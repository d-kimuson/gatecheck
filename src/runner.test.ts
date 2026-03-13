import { describe, test, expect } from 'vitest';
import { runChecks, runReviews, reportCheckResults, reportReviewResults } from './runner.ts';
import type { CheckResult, ReviewResult } from './types.ts';

describe('runChecks', () => {
  const cwd = '/tmp';

  test('returns passed for successful command', async () => {
    const entries = [{ name: 'echo-test', match: '.*', group: 'test', command: 'echo hello' }];
    const results = await runChecks(entries, ['/tmp/file.ts'], cwd);
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('passed');
  });

  test('returns failed with output for failing command', async () => {
    const entries = [
      { name: 'fail-test', match: '.*', group: 'test', command: 'echo oops >&2; exit 1' },
    ];
    const results = await runChecks(entries, ['/tmp/file.ts'], cwd);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ status: 'failed', exitCode: 1 });
  });

  test('returns skip when no files match pattern', async () => {
    const entries = [{ name: 'skip-test', match: '\\.css$', group: 'test', command: 'exit 1' }];
    const results = await runChecks(entries, ['/tmp/file.ts'], cwd);
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('skip');
  });

  test('runs multiple checks in parallel', async () => {
    const entries = [
      { name: 'a', match: '.*', group: 'test', command: 'echo a' },
      { name: 'b', match: '.*', group: 'test', command: 'echo b' },
    ];
    const results = await runChecks(entries, ['/tmp/file.ts'], cwd);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === 'passed')).toBe(true);
  });

  test('runs grouped checks when pattern has named capture groups', async () => {
    const entries = [
      {
        name: 'echo-group',
        match: '^(?<workspace>app|lib)/.*\\.ts$',
        group: 'test',
        command: 'echo {{ match.workspace }}',
      },
    ];
    const results = await runChecks(entries, ['/tmp/app/index.ts', '/tmp/lib/utils.ts'], cwd);
    expect(results).toHaveLength(2);
    const names = results.map((r) => r.name);
    expect(names).toContain('echo-group[app]');
    expect(names).toContain('echo-group[lib]');
    expect(results.every((r) => r.status === 'passed')).toBe(true);
  });

  test('excludes files matching exclude pattern', async () => {
    const entries = [
      {
        name: 'lint',
        match: '\\.ts$',
        exclude: '**/*.test.ts',
        group: 'lint',
        command: 'echo ok',
      },
    ];
    const results = await runChecks(entries, ['/tmp/index.test.ts'], cwd);
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('skip');
  });

  test('replaces {{ ctx.CHANGED_FILES }} in command', async () => {
    const entries = [
      { name: 'lint', match: '.*', group: 'lint', command: 'echo {{ ctx.CHANGED_FILES }}' },
    ];
    const results = await runChecks(entries, ['/tmp/file.ts'], cwd);
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('passed');
    expect(JSON.stringify(results[0])).toContain('file.ts');
  });
});

describe('runReviews', () => {
  const cwd = '/tmp';

  test('returns completed for successful review', async () => {
    const entries = [{ name: 'review', match: '.*', command: 'echo reviewed' }];
    const results = await runReviews(entries, ['/tmp/file.ts'], cwd, 'diff summary');
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('completed');
  });

  test('returns skip when no files match', async () => {
    const entries = [{ name: 'review', match: '\\.css$', command: 'echo reviewed' }];
    const results = await runReviews(entries, ['/tmp/file.ts'], cwd, 'diff');
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('skip');
  });

  test('uses fallback when primary command fails', async () => {
    const entries = [
      {
        name: 'review',
        match: '.*',

        command: 'exit 1',
        fallbacks: ['echo fallback-ok'],
      },
    ];
    const results = await runReviews(entries, ['/tmp/file.ts'], cwd, 'diff');
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('completed');
    expect(JSON.stringify(results[0])).toContain('fallback-ok');
  });

  test('fails when all commands including fallbacks fail', async () => {
    const entries = [
      {
        name: 'review',
        match: '.*',

        command: 'exit 1',
        fallbacks: ['exit 2'],
      },
    ];
    const results = await runReviews(entries, ['/tmp/file.ts'], cwd, 'diff');
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('failed');
  });

  test('resolves vars in command', async () => {
    const entries = [
      {
        name: 'review',
        match: '.*',

        vars: { msg: 'hello' },
        command: 'echo {{ vars.msg }}',
      },
    ];
    const results = await runReviews(entries, ['/tmp/file.ts'], cwd, 'diff');
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('completed');
    expect(JSON.stringify(results[0])).toContain('hello');
  });
});

describe('reportCheckResults', () => {
  test('returns true when all checks pass', () => {
    const results: readonly CheckResult[] = [{ status: 'passed', name: 'a', command: 'echo a' }];
    expect(reportCheckResults(results)).toBe(true);
  });

  test('returns false when any check fails', () => {
    const results: readonly CheckResult[] = [
      { status: 'passed', name: 'a', command: 'echo a' },
      {
        status: 'failed',
        name: 'b',
        command: 'exit 1',
        exitCode: 1,
        stdout: 'out',
        stderr: 'err',
      },
    ];
    expect(reportCheckResults(results)).toBe(false);
  });

  test('returns true when all skipped', () => {
    const results: readonly CheckResult[] = [{ status: 'skip', name: 'a' }];
    expect(reportCheckResults(results)).toBe(true);
  });
});

describe('reportReviewResults', () => {
  test('returns true when all reviews completed', () => {
    const results: readonly ReviewResult[] = [
      { status: 'completed', name: 'a', command: 'echo', stdout: 'ok' },
    ];
    expect(reportReviewResults(results)).toBe(true);
  });

  test('returns false when any review fails', () => {
    const results: readonly ReviewResult[] = [
      { status: 'failed', name: 'a', command: 'exit 1', exitCode: 1, stdout: '', stderr: 'err' },
    ];
    expect(reportReviewResults(results)).toBe(false);
  });
});
