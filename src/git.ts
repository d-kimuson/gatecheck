import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import type { ChangedSource } from './types.ts';

const exec = (cmd: string, args: readonly string[], cwd: string): Promise<string> =>
  new Promise((res, rej) => {
    execFile(cmd, [...args], { cwd }, (error, stdout) => {
      if (error) {
        rej(error);
        return;
      }
      res(stdout);
    });
  });

const gitCommandForSource = (source: ChangedSource): readonly [string, ...string[]] => {
  switch (source.type) {
    case 'untracked':
      return ['ls-files', '--others', '--exclude-standard'];
    case 'unstaged':
      return ['diff', '--name-only', '--diff-filter=d'];
    case 'staged':
      return ['diff', '--cached', '--name-only', '--diff-filter=d'];
    case 'branch':
      return ['diff', '--name-only', '--diff-filter=d', `${source.name}...HEAD`];
    case 'sha':
      return ['diff', '--name-only', '--diff-filter=d', `${source.sha}...HEAD`];
    default: {
      const _exhaustive: never = source;
      throw new Error(`Unknown source type: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

const parseFileList = (output: string): readonly string[] =>
  output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const describeSource = (source: ChangedSource): string => {
  switch (source.type) {
    case 'untracked':
      return 'untracked files';
    case 'unstaged':
      return 'unstaged changes';
    case 'staged':
      return 'staged changes';
    case 'branch':
      return `branch '${source.name}'`;
    case 'sha':
      return `sha '${source.sha}'`;
    default: {
      const _exhaustive: never = source;
      throw new Error(`Unknown source type: ${JSON.stringify(_exhaustive)}`);
    }
  }
};

// Get diff summary for review context
export const getDiffSummary = async (
  sources: readonly ChangedSource[],
  cwd: string,
): Promise<string> => {
  const results = await Promise.all(
    sources.map(async (source) => {
      const baseArgs = gitCommandForSource(source);
      // Remove --name-only to get full diff, but keep --diff-filter=d
      const args = baseArgs.filter((a) => a !== '--name-only');
      try {
        return await exec('git', args, cwd);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to get diff for ${describeSource(source)}: ${detail}`);
      }
    }),
  );

  return results.filter((r) => r.trim().length > 0).join('\n');
};

export const getChangedFiles = async (
  sources: readonly ChangedSource[],
  cwd: string,
): Promise<readonly string[]> => {
  const results = await Promise.all(
    sources.map(async (source) => {
      const args = gitCommandForSource(source);
      try {
        const output = await exec('git', args, cwd);
        return parseFileList(output);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to get changed files for ${describeSource(source)}: ${detail}`);
      }
    }),
  );

  // Deduplicate and resolve to absolute paths
  const seen = new Set<string>();
  const files: string[] = [];

  for (const list of results) {
    for (const file of list) {
      const abs = resolve(cwd, file);
      if (!seen.has(abs)) {
        seen.add(abs);
        files.push(abs);
      }
    }
  }

  return files;
};
