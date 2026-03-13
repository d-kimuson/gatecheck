import { spawn } from 'node:child_process';
import { relative } from 'node:path';
import { log, logError } from './logger.ts';
import { matchFiles, groupMatchResults } from './matcher.ts';
import * as template from './template.ts';
import type { CheckEntry, ReviewEntry, CheckResult, ReviewResult } from './types.ts';

// -- Shell execution --

const runCommand = (
  command: string,
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> =>
  new Promise((res) => {
    const child = spawn('sh', ['-c', command], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    child.on('close', (code) => {
      res({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString(),
        stderr: Buffer.concat(stderrChunks).toString(),
      });
    });
  });

// -- Helpers --

const formatFileList = (files: readonly string[], cwd: string): string =>
  files.map((f) => `'${relative(cwd, f).replaceAll("'", "'\\''")}'`).join(' ');

const hasNamedGroups = (pattern: string): boolean => /\(\?<[^>]+>/.test(pattern);

// -- Check execution --

const runSingleCheckEntry = async (
  entry: CheckEntry,
  changedFiles: readonly string[],
  cwd: string,
): Promise<readonly CheckResult[]> => {
  const matched = matchFiles(changedFiles, entry.match, cwd, entry.exclude);

  if (matched.length === 0) {
    return [{ status: 'skip', name: entry.name }];
  }

  if (hasNamedGroups(entry.match)) {
    const grouped = groupMatchResults(matched);
    const results = await Promise.all(
      [...grouped.entries()].map(async ([groupKey, group]): Promise<CheckResult> => {
        const checkName = groupKey ? `${entry.name}[${groupKey}]` : entry.name;
        const ctx = { CHANGED_FILES: formatFileList(group.files, cwd) };
        const context = template.buildContext({ match: group.groups, ctx });
        const command = template.resolve(entry.command, context);

        const { exitCode, stdout, stderr } = await runCommand(command, cwd);
        if (exitCode === 0) {
          return { status: 'passed', name: checkName, command };
        }
        return { status: 'failed', name: checkName, command, exitCode, stdout, stderr };
      }),
    );
    return results;
  }

  const allFiles = matched.map((m) => m.file);
  const ctx = { CHANGED_FILES: formatFileList(allFiles, cwd) };
  const context = template.buildContext({ ctx });
  const command = template.resolve(entry.command, context);

  const { exitCode, stdout, stderr } = await runCommand(command, cwd);
  if (exitCode === 0) {
    return [{ status: 'passed', name: entry.name, command }];
  }
  return [{ status: 'failed', name: entry.name, command, exitCode, stdout, stderr }];
};

export const runChecks = async (
  entries: readonly CheckEntry[],
  changedFiles: readonly string[],
  cwd: string,
): Promise<readonly CheckResult[]> => {
  const results = await Promise.allSettled(
    entries.map((entry) => runSingleCheckEntry(entry, changedFiles, cwd)),
  );

  return results.flatMap((result, i) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    const entry = entries[i];
    if (!entry) {
      throw new Error(`Unexpected missing entry at index ${i}`);
    }
    return [
      {
        status: 'failed',
        name: entry.name,
        command: entry.command,
        exitCode: 1,
        stdout: '',
        stderr: result.reason instanceof Error ? result.reason.message : String(result.reason),
      } satisfies CheckResult,
    ];
  });
};

// -- Review execution --

const runReviewWithFallbacks = async (
  commands: readonly string[],
  cwd: string,
  name: string,
): Promise<ReviewResult> => {
  for (const command of commands) {
    const { exitCode, stdout, stderr } = await runCommand(command, cwd);
    if (exitCode === 0) {
      return { status: 'completed', name, command, stdout };
    }
    // Non-zero: try next fallback
    if (command === commands[commands.length - 1]) {
      // Last command failed
      return { status: 'failed', name, command, exitCode, stdout, stderr };
    }
  }
  // Should not reach here, but satisfy type checker
  return {
    status: 'failed',
    name,
    command: commands[commands.length - 1] ?? '',
    exitCode: 1,
    stdout: '',
    stderr: 'No commands to execute',
  };
};

const runSingleReviewEntry = async (
  entry: ReviewEntry,
  changedFiles: readonly string[],
  cwd: string,
  diffSummary: string,
): Promise<readonly ReviewResult[]> => {
  const matched = matchFiles(changedFiles, entry.match, cwd, entry.exclude);

  if (matched.length === 0) {
    return [{ status: 'skip', name: entry.name }];
  }

  const allFiles = matched.map((m) => m.file);
  const matchGroups = matched[0]?.groups ?? {};

  const ctx: Record<string, string> = {
    DIFF_SUMMARY: diffSummary,
    CHANGED_FILES: formatFileList(allFiles, cwd),
  };

  const baseContext = template.buildContext({ match: matchGroups, ctx });

  // Resolve vars (can reference env, match, ctx)
  const resolvedVars = entry.vars ? template.resolveVars(entry.vars, baseContext) : {};

  const fullContext = template.buildContext({
    match: matchGroups,
    ctx,
    vars: resolvedVars,
  });

  // Build command list: primary + fallbacks
  const commands = [entry.command, ...(entry.fallbacks ?? [])].map((cmd) =>
    template.resolve(cmd, fullContext),
  );

  const result = await runReviewWithFallbacks(commands, cwd, entry.name);
  return [result];
};

export const runReviews = async (
  entries: readonly ReviewEntry[],
  changedFiles: readonly string[],
  cwd: string,
  diffSummary: string,
): Promise<readonly ReviewResult[]> => {
  const results = await Promise.allSettled(
    entries.map((entry) => runSingleReviewEntry(entry, changedFiles, cwd, diffSummary)),
  );

  return results.flatMap((result, i) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    const entry = entries[i];
    if (!entry) {
      throw new Error(`Unexpected missing entry at index ${i}`);
    }
    return [
      {
        status: 'failed',
        name: entry.name,
        command: entry.command,
        exitCode: 1,
        stdout: '',
        stderr: result.reason instanceof Error ? result.reason.message : String(result.reason),
      } satisfies ReviewResult,
    ];
  });
};

// -- Dry run (checks) --

export const dryRunChecks = (
  entries: readonly CheckEntry[],
  changedFiles: readonly string[],
  cwd: string,
): void => {
  for (const entry of entries) {
    const matched = matchFiles(changedFiles, entry.match, cwd, entry.exclude);

    if (matched.length === 0) {
      log(`  [skip] ${entry.name} (no matching files)`);
      continue;
    }

    if (hasNamedGroups(entry.match)) {
      const grouped = groupMatchResults(matched);
      for (const [groupKey, group] of grouped) {
        const checkName = groupKey ? `${entry.name}[${groupKey}]` : entry.name;
        const ctx = { CHANGED_FILES: formatFileList(group.files, cwd) };
        const context = template.buildContext({ match: group.groups, ctx });
        const command = template.resolve(entry.command, context);
        log(`  [run]  ${checkName}`);
        log(`         $ ${command}`);
      }
    } else {
      const allFiles = matched.map((m) => m.file);
      const ctx = { CHANGED_FILES: formatFileList(allFiles, cwd) };
      const context = template.buildContext({ ctx });
      const command = template.resolve(entry.command, context);
      log(`  [run]  ${entry.name}`);
      log(`         $ ${command}`);
    }
  }
};

// -- Dry run (reviews) --

export const dryRunReviews = (
  entries: readonly ReviewEntry[],
  changedFiles: readonly string[],
  cwd: string,
  diffSummary: string,
): void => {
  for (const entry of entries) {
    const matched = matchFiles(changedFiles, entry.match, cwd, entry.exclude);

    if (matched.length === 0) {
      log(`${entry.name}: (no matching files)\n`);
      continue;
    }

    const allFiles = matched.map((m) => m.file);
    const matchGroups = matched[0]?.groups ?? {};
    const ctx: Record<string, string> = {
      DIFF_SUMMARY: diffSummary,
      CHANGED_FILES: formatFileList(allFiles, cwd),
    };

    const baseContext = template.buildContext({ match: matchGroups, ctx });
    const resolvedVars = entry.vars ? template.resolveVars(entry.vars, baseContext) : {};
    const fullContext = template.buildContext({ match: matchGroups, ctx, vars: resolvedVars });

    log(`${entry.name}:`);
    log('');

    log('  ctx:');
    for (const [key, value] of Object.entries(ctx)) {
      const lines = value.split('\n');
      if (lines.length <= 5) {
        log(`    ${key}: ${value}`);
      } else {
        log(`    ${key}: (${lines.length} lines)`);
      }
    }
    log('');

    if (entry.vars !== undefined) {
      log('  vars:');
      for (const [key, value] of Object.entries(resolvedVars)) {
        log(`    ${key}: ${value}`);
      }
      log('');
    }

    const commands = [entry.command, ...(entry.fallbacks ?? [])].map((cmd) =>
      template.resolve(cmd, fullContext),
    );
    for (const cmd of commands) {
      log(`  $ ${cmd}`);
    }

    log('');
  }
};

// -- Report (text) --

export const reportCheckResults = (results: readonly CheckResult[]): boolean => {
  const skipped = results.filter((r) => r.status === 'skip');
  const passed = results.filter((r) => r.status === 'passed');
  const failed = results.filter((r) => r.status === 'failed');

  if (failed.length > 0) {
    for (const r of failed) {
      logError(`\n── ${r.name} ──`);
      if (r.stdout) logError(r.stdout.trimEnd());
      if (r.stderr) logError(r.stderr.trimEnd());
    }
  }

  log('');

  for (const r of skipped) {
    log(`  - ${r.name} [skipped]`);
  }
  for (const r of passed) {
    log(`  ✓ ${r.name} [passed]`);
  }
  for (const r of failed) {
    log(`  ✗ ${r.name} [failed]`);
  }

  if (failed.length > 0) {
    log(`\n${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped`);
    return false;
  }

  log(`\n${passed.length} passed, ${skipped.length} skipped`);
  return true;
};

export const reportReviewResults = (results: readonly ReviewResult[]): boolean => {
  const skipped = results.filter((r) => r.status === 'skip');
  const completed = results.filter((r) => r.status === 'completed');
  const failed = results.filter((r) => r.status === 'failed');

  for (const r of completed) {
    log(`\n── ${r.name} ──`);
    if (r.stdout) log(r.stdout.trimEnd());
  }

  if (failed.length > 0) {
    for (const r of failed) {
      logError(`\n── ${r.name} (failed) ──`);
      if (r.stdout) logError(r.stdout.trimEnd());
      if (r.stderr) logError(r.stderr.trimEnd());
    }
  }

  log('');

  for (const r of skipped) {
    log(`  - ${r.name} [skipped]`);
  }
  for (const r of completed) {
    log(`  ✓ ${r.name} [completed]`);
  }
  for (const r of failed) {
    log(`  ✗ ${r.name} [failed]`);
  }

  if (failed.length > 0) {
    log(`\n${completed.length} completed, ${failed.length} failed, ${skipped.length} skipped`);
    return false;
  }

  log(`\n${completed.length} completed, ${skipped.length} skipped`);
  return true;
};
