#!/usr/bin/env node

import { Command } from 'commander';
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

// -- check command --

type CheckOpts = {
  changed?: string;
  target?: string;
  dryRun?: boolean;
};

const check = async (opts: CheckOpts): Promise<void> => {
  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const entries = filterByTarget(config.checks ?? [], opts.target);

  if (entries.length === 0) {
    log('No checks configured.');
    return;
  }

  const changedSources =
    opts.changed !== undefined ? parseChangedSources(opts.changed) : DEFAULT_SOURCES;
  const changedFiles = await getChangedFiles(changedSources, cwd);

  if (changedFiles.length === 0) {
    log('No changed files found.');
    return;
  }

  log(`Found ${changedFiles.length} changed file(s).`);

  if (opts.dryRun === true) {
    log('');
    dryRunChecks(entries, changedFiles, cwd);
    return;
  }

  log(`Running ${entries.length} check(s)...`);

  const results = await runChecks(entries, changedFiles, cwd);
  const allPassed = reportCheckResults(results);

  if (!allPassed) {
    process.exitCode = 1;
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
    opts.changed !== undefined ? parseChangedSources(opts.changed) : DEFAULT_SOURCES;
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

program.parseAsync().catch((error: unknown) => {
  if (error instanceof ConfigNotFoundError) {
    logError(error.message);
  } else {
    logError(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
});
