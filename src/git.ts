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
      return ['diff', '--name-only'];
    case 'staged':
      return ['diff', '--cached', '--name-only'];
    case 'branch':
      return ['diff', '--name-only', `${source.name}...HEAD`];
    case 'sha':
      return ['diff', '--name-only', `${source.sha}...HEAD`];
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
    case 'branch':
      return `branch '${source.name}'`;
    case 'sha':
      return `sha '${source.sha}'`;
    case "staged": { throw new Error('Not implemented yet: "staged" case') }
    case "unstaged": { throw new Error('Not implemented yet: "unstaged" case') }
    case "untracked": { throw new Error('Not implemented yet: "untracked" case') }
    default:
      return source.type;
  }
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
