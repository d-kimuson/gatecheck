#!/usr/bin/env node

import { Command, Option } from 'commander';
import pkg from '../package.json' with { type: 'json' };
import { loadConfig, ConfigNotFoundError } from './config.ts';
import { getChangedFiles, getDiffSummary } from './git.ts';
import { log, logError } from './logger.ts';
import {
  runChecks,
  runReviews,
  dryRunChecks,
  dryRunReviews,
  reportCheckResults,
  reportCheckResultsJson,
  reportCheckResultsHooks,
  reportReviewResults,
} from './runner.ts';
import type { ChangedSource } from './types.ts';

// -- Parse ChangedSource --

const parseChangedSource = (raw: string): ChangedSource => {
  if (raw === 'untracked') return { type: 'untracked' };
  if (raw === 'unstaged') return { type: 'unstaged' };
  if (raw === 'staged') return { type: 'staged' };
  if (raw.startsWith('branch:')) {
    const name = raw.slice(7);
    if (name === '') throw new Error('branch: requires a branch name (e.g. branch:main)');
    return { type: 'branch', name };
  }
  if (raw.startsWith('sha:')) {
    const sha = raw.slice(4);
    if (sha === '') throw new Error('sha: requires a commit SHA (e.g. sha:abc1234)');
    return { type: 'sha', sha };
  }
  throw new Error(`Unknown changed source: ${raw}`);
};

const parseChangedSources = (raw: string): readonly ChangedSource[] =>
  raw.split(',').map((s) => parseChangedSource(s.trim()));

const DEFAULT_SOURCES: readonly ChangedSource[] = [{ type: 'unstaged' }, { type: 'staged' }];

// -- Target filtering --

const filterByTarget = <T extends { readonly group: string }>(
  entries: readonly T[],
  target: string | undefined,
): readonly T[] => {
  if (target === undefined || target === 'all') {
    return entries;
  }

  const groups = target.split(',').map((s) => s.trim());
  const knownGroups = new Set(entries.map((e) => e.group));
  const unknown = groups.filter((g) => !knownGroups.has(g));
  if (unknown.length > 0) {
    logError(`Warning: unknown target group(s): ${unknown.join(', ')}`);
  }

  return entries.filter((e) => groups.includes(e.group));
};

// -- Output format --

type OutputFormat =
  | 'text'
  | 'json'
  | 'claude-code-hooks'
  | 'claude-code-hooks-strict'
  | 'copilot-cli-hooks';

const parseFormat = (raw: string | undefined): OutputFormat => {
  if (raw === 'json') return 'json';
  if (raw === 'claude-code-hooks') return 'claude-code-hooks';
  if (raw === 'claude-code-hooks-strict') return 'claude-code-hooks-strict';
  if (raw === 'copilot-cli-hooks') return 'copilot-cli-hooks';
  return 'text';
};

// -- stdin (hooks input) --

const readStdin = (): Promise<string> =>
  new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });

export const parseStopHookActive = (raw: string): boolean => {
  if (raw.trim() === '') return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return false;
    if (!('stop_hook_active' in parsed)) return false;
    return (parsed as Record<string, unknown>)['stop_hook_active'] === true;
  } catch {
    return false;
  }
};

const isStopHookActive = async (): Promise<boolean> => parseStopHookActive(await readStdin());

// -- check command --

type CheckOpts = {
  changed?: string;
  target?: string;
  dryRun?: boolean;
  format?: string;
};

const check = async (opts: CheckOpts): Promise<void> => {
  const cwd = process.cwd();
  const fmt = parseFormat(opts.format);
  const config = await loadConfig(cwd);

  if (opts.dryRun === true && fmt !== 'text') {
    throw new Error('--dry-run can only be used with --format text');
  }

  const entries = filterByTarget(config.checks ?? [], opts.target ?? config.defaults?.target);

  if (entries.length === 0) {
    if (fmt === 'text') log('No checks configured.');
    if (fmt === 'json') log(JSON.stringify(reportCheckResultsJson([])));
    if (
      fmt === 'claude-code-hooks' ||
      fmt === 'claude-code-hooks-strict' ||
      fmt === 'copilot-cli-hooks'
    ) {
      // No checks = no block
    }
    return;
  }

  const changedSources =
    opts.changed !== undefined
      ? parseChangedSources(opts.changed)
      : config.defaults?.changed !== undefined
        ? parseChangedSources(config.defaults.changed)
        : DEFAULT_SOURCES;
  const changedFiles = await getChangedFiles(changedSources, cwd);

  if (changedFiles.length === 0) {
    if (fmt === 'text') log('No changed files found.');
    if (fmt === 'json') log(JSON.stringify(reportCheckResultsJson([])));
    return;
  }

  if (fmt === 'text') log(`Found ${changedFiles.length} changed file(s).`);

  if (opts.dryRun === true) {
    log('');
    dryRunChecks(entries, changedFiles, cwd);
    return;
  }

  if (fmt === 'text') log(`Running ${entries.length} check(s)...`);

  const results = await runChecks(entries, changedFiles, cwd);

  switch (fmt) {
    case 'text': {
      const allPassed = reportCheckResults(results);
      if (!allPassed) process.exitCode = 1;
      break;
    }
    case 'json': {
      const output = reportCheckResultsJson(results);
      log(JSON.stringify(output, null, 2));
      if (output.status === 'failed') process.exitCode = 1;
      break;
    }
    case 'claude-code-hooks': {
      if (await isStopHookActive()) break;
      const output = reportCheckResultsHooks(results);
      if (output !== null) {
        log(JSON.stringify(output));
        process.exitCode = 1;
      }
      break;
    }
    case 'claude-code-hooks-strict':
    case 'copilot-cli-hooks': {
      const output = reportCheckResultsHooks(results);
      if (output !== null) {
        log(JSON.stringify(output));
        process.exitCode = 1;
      }
      break;
    }
    default: {
      const _exhaustive: never = fmt;
      throw new Error(`Unknown format: ${String(_exhaustive)}`);
    }
  }
};

// -- review command --

type ReviewOpts = {
  changed?: string;
  dryRun?: boolean;
};

const review = async (opts: ReviewOpts): Promise<void> => {
  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const entries = config.reviews ?? [];

  if (entries.length === 0) {
    log('No reviews configured.');
    return;
  }

  const changedSources =
    opts.changed !== undefined
      ? parseChangedSources(opts.changed)
      : config.defaults?.changed !== undefined
        ? parseChangedSources(config.defaults.changed)
        : DEFAULT_SOURCES;
  const changedFiles = await getChangedFiles(changedSources, cwd);

  if (changedFiles.length === 0) {
    log('No changed files found.');
    return;
  }

  log(`Found ${changedFiles.length} changed file(s).`);

  const diffSummary = await getDiffSummary(changedSources, cwd);

  if (opts.dryRun === true) {
    log('');
    dryRunReviews(entries, changedFiles, cwd, diffSummary);
    return;
  }

  log(`Running ${entries.length} review(s)...`);

  const results = await runReviews(entries, changedFiles, cwd, diffSummary);
  const allPassed = reportReviewResults(results);

  if (!allPassed) {
    process.exitCode = 1;
  }
};

// -- CLI definition --

const program = new Command().name('gatecheck').description(pkg.description).version(pkg.version);

program
  .command('check')
  .description('Run deterministic checks (lint, typecheck, test) against changed files')
  .option(
    '-c, --changed <sources>',
    'Changed sources (comma-separated: untracked,unstaged,staged,branch:<name>,sha:<sha>)',
  )
  .option('-t, --target <groups>', 'Target groups (comma-separated or "all")')
  .option('-d, --dry-run', 'Show which checks would run without executing them')
  .addOption(
    new Option('-f, --format <format>', 'Output format').choices([
      'text',
      'json',
      'claude-code-hooks',
      'claude-code-hooks-strict',
      'copilot-cli-hooks',
    ]),
  )
  .action(check);

program
  .command('review')
  .description('Run AI-powered reviews against changed files')
  .option(
    '-c, --changed <sources>',
    'Changed sources (comma-separated: untracked,unstaged,staged,branch:<name>,sha:<sha>)',
  )
  .option('-d, --dry-run', 'Show review configuration and matched files without executing')
  .action(review);

program
  .command('setup')
  .description('Create or update gatecheck.yaml')
  .option('--non-interactive', 'Skip prompts and use defaults with auto-detected presets')
  .action(async (opts: { nonInteractive?: boolean }) => {
    const { runSetup } = await import('./setup.ts');
    await runSetup(process.cwd(), { nonInteractive: opts.nonInteractive });
  });

program.parseAsync().catch((error: unknown) => {
  if (error instanceof ConfigNotFoundError) {
    logError(error.message);
  } else {
    logError(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
});
