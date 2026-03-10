#!/usr/bin/env node

import { Command, Option } from 'commander';
import pkg from '../package.json' with { type: 'json' };
import { loadConfig, ConfigNotFoundError } from './config.ts';
import { getChangedFiles } from './git.ts';
import { log, logError } from './logger.ts';
import {
  runChecks,
  dryRunChecks,
  reportResults,
  reportResultsJson,
  reportResultsHooks,
} from './runner.ts';
import type { ChangedSource, CheckResult } from './types.ts';

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

// -- Run checks --

type RunOpts = {
  changed?: string;
  target?: string;
  dryRun?: boolean;
  format?: string;
};

type OutputFormat = 'text' | 'json' | 'claude-code-hooks' | 'copilot-cli-hooks';

const getFormat = (opts: RunOpts): OutputFormat => {
  if (opts.format === 'json') return 'json';
  if (opts.format === 'claude-code-hooks') return 'claude-code-hooks';
  if (opts.format === 'copilot-cli-hooks') return 'copilot-cli-hooks';
  return 'text';
};

const isSilent = (fmt: OutputFormat): boolean => fmt !== 'text';

const validateRunOptions = (opts: RunOpts, fmt: OutputFormat): void => {
  if (opts.dryRun === true && fmt !== 'text') {
    throw new Error('--dry-run can only be used with --format text');
  }
};

const getReporter = (fmt: OutputFormat): ((results: readonly CheckResult[]) => boolean) => {
  switch (fmt) {
    case 'json':
      return reportResultsJson;
    case 'claude-code-hooks':
      return reportResultsHooks;
    case 'copilot-cli-hooks':
      return reportResultsHooks;
    case 'text':
      return reportResults;
    default: {
      const _exhaustive: never = fmt;
      throw new Error(`Unknown format: ${String(_exhaustive)}`);
    }
  }
};

const run = async (opts: RunOpts): Promise<void> => {
  const cwd = process.cwd();
  const fmt = getFormat(opts);
  validateRunOptions(opts, fmt);
  const config = await loadConfig(cwd);

  const changedSources =
    opts.changed !== undefined && opts.changed !== ''
      ? parseChangedSources(opts.changed)
      : parseChangedSources(config.defaults.changed);

  const target =
    opts.target !== undefined && opts.target !== '' && opts.target !== 'all'
      ? opts.target.split(',').map((s) => s.trim())
      : config.defaults.target === 'all'
        ? ('all' as const)
        : config.defaults.target.split(',').map((s) => s.trim());

  if (target !== 'all') {
    const knownGroups = new Set(Object.values(config.checks).map((c) => c.group));
    const unknown = target.filter((t) => !knownGroups.has(t));
    if (unknown.length > 0) {
      logError(`Warning: unknown target group(s): ${unknown.join(', ')}`);
    }
  }

  const checks = new Map(
    Object.entries(config.checks).filter(([, check]) =>
      target === 'all' ? true : target.includes(check.group),
    ),
  );

  if (checks.size === 0) {
    if (isSilent(fmt)) {
      getReporter(fmt)([]);
    } else {
      log('No checks to run.');
    }
    return;
  }

  const changedFiles = await getChangedFiles(changedSources, cwd);

  if (changedFiles.length === 0) {
    if (isSilent(fmt)) {
      getReporter(fmt)([]);
    } else {
      log('No changed files found.');
    }
    return;
  }

  if (!isSilent(fmt)) {
    log(`Found ${changedFiles.length} changed file(s).`);
  }

  if (opts.dryRun === true) {
    log('');
    dryRunChecks(checks, changedFiles, cwd);
    return;
  }

  if (!isSilent(fmt)) {
    log(`Running ${checks.size} check(s)...`);
  }

  const results = await runChecks(checks, changedFiles, cwd);
  const allPassed = getReporter(fmt)(results);

  if (!allPassed) {
    process.exitCode = 1;
  }
};

// -- CLI definition --

const program = new Command().name(pkg.name).description(pkg.description).version(pkg.version);

program
  .command('run', { isDefault: true })
  .description('Run configured checks against changed files')
  .option(
    '-c, --changed <sources>',
    'Changed sources (comma-separated: untracked,unstaged,staged,branch:<name>,sha:<sha>)',
  )
  .option('-t, --target <groups>', 'Target groups (comma-separated or "all")')
  .option('-d, --dry-run', 'Show which checks would run without executing them (text format only)')
  .addOption(
    new Option('-f, --format <format>', 'Output format').choices([
      'text',
      'json',
      'claude-code-hooks',
      'copilot-cli-hooks',
    ]),
  )
  .action(run);

program
  .command('setup')
  .description('Create or update .check-changedrc.json')
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
