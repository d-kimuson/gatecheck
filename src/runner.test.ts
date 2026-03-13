import { describe, test, expect } from 'vitest';
import {
  runChecks,
  runReviews,
  reportCheckResults,
  reportReviewResults,
  reportCheckResultsJson,
  reportCheckResultsHooks,
} from './runner.ts';
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

  test('uses absolute paths when changedFiles.path is absolute', async () => {
    const entries = [
      {
        name: 'abs',
        match: '.*',
        group: 'test',
        command: 'echo {{ ctx.CHANGED_FILES }}',
        changedFiles: { path: 'absolute' } as const,
      },
    ];
    const results = await runChecks(entries, ['/tmp/file.ts'], cwd);
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('passed');
    expect(JSON.stringify(results[0])).toContain('/tmp/file.ts');
  });

  test('uses custom separator when changedFiles.separator is set', async () => {
    const entries = [
      {
        name: 'sep',
        match: '.*',
        group: 'test',
        command: 'printf "%s" {{ ctx.CHANGED_FILES }}',
        changedFiles: { separator: ',' },
      },
    ];
    const results = await runChecks(entries, ['/tmp/a.ts', '/tmp/b.ts'], cwd);
    expect(results).toHaveLength(1);
    expect(JSON.stringify(results[0])).toContain("'a.ts','b.ts'");
  });

  test('handles files with single quotes in path', async () => {
    const entries = [
      { name: 'quote', match: '.*', group: 'test', command: 'echo {{ ctx.CHANGED_FILES }}' },
    ];
    const results = await runChecks(entries, ["/tmp/it's.ts"], cwd);
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('passed');
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

  test('auto-shell-escapes vars in command', async () => {
    const entries = [
      {
        name: 'review',
        match: '.*',

        vars: { msg: "it's working" },
        command: 'echo {{ vars.msg }}',
      },
    ];
    const results = await runReviews(entries, ['/tmp/file.ts'], cwd, 'diff');
    expect(results).toHaveLength(1);
    // Shell correctly interprets the escaped single quote
    expect(results[0]?.status).toBe('completed');
    expect(JSON.stringify(results[0])).toContain("it's working");
  });

  test('CHANGED_FILES in review is plain (not shell-escaped)', async () => {
    const entries = [
      {
        name: 'review',
        match: '.*',

        vars: { prompt: 'files: {{ ctx.CHANGED_FILES }}' },
        command: 'echo {{ vars.prompt }}',
      },
    ];
    const results = await runReviews(entries, ['/tmp/a.ts', '/tmp/b.ts'], cwd, 'diff');
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('completed');
    // Plain paths in prompt, not shell-escaped with individual quotes
    expect(JSON.stringify(results[0])).toContain('files: a.ts b.ts');
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

describe('reportCheckResultsJson', () => {
  test('outputs JSON with passed status when all pass', () => {
    const results: readonly CheckResult[] = [{ status: 'passed', name: 'lint', command: 'eslint' }];
    const output = reportCheckResultsJson(results);
    expect(output.status).toBe('passed');
    expect(output.summary).toEqual({ passed: 1, failed: 0, skipped: 0 });
    expect(output.checks).toHaveLength(1);
  });

  test('outputs JSON with failed status when any fail', () => {
    const results: readonly CheckResult[] = [
      { status: 'passed', name: 'lint', command: 'eslint' },
      {
        status: 'failed',
        name: 'test',
        command: 'vitest',
        exitCode: 1,
        stdout: 'out',
        stderr: 'err',
      },
    ];
    const output = reportCheckResultsJson(results);
    expect(output.status).toBe('failed');
    expect(output.summary).toEqual({ passed: 1, failed: 1, skipped: 0 });
  });

  test('includes skipped checks', () => {
    const results: readonly CheckResult[] = [{ status: 'skip', name: 'a' }];
    const output = reportCheckResultsJson(results);
    expect(output.status).toBe('passed');
    expect(output.summary.skipped).toBe(1);
  });
});

describe('reportCheckResultsHooks', () => {
  test('returns null when all pass', () => {
    const results: readonly CheckResult[] = [{ status: 'passed', name: 'lint', command: 'eslint' }];
    expect(reportCheckResultsHooks(results)).toBeNull();
  });

  test('returns block decision with reason when checks fail', () => {
    const results: readonly CheckResult[] = [
      {
        status: 'failed',
        name: 'test',
        command: 'vitest',
        exitCode: 1,
        stdout: 'FAIL',
        stderr: 'error',
      },
    ];
    const output = reportCheckResultsHooks(results);
    expect(output).not.toBeNull();
    expect(output?.decision).toBe('block');
    expect(output?.reason).toContain('test');
    expect(output?.reason).toContain('FAIL');
  });
});
