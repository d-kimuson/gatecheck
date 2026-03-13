import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';

const lockfiles = [
  { file: 'pnpm-lock.yaml', pm: 'pnpm' },
  { file: 'bun.lockb', pm: 'bun' },
  { file: 'bun.lock', pm: 'bun' },
  { file: 'yarn.lock', pm: 'yarn' },
  { file: 'package-lock.json', pm: 'npm' },
] as const satisfies readonly { file: string; pm: PackageManager }[];

export const detectPackageManager = async (cwd: string): Promise<PackageManager> => {
  for (const { file, pm } of lockfiles) {
    try {
      await access(resolve(cwd, file));
      return pm;
    } catch {
      // not found, try next
    }
  }
  return 'npm';
};

const executors = {
  pnpm: 'pnpm exec',
  npm: 'npx',
  yarn: 'yarn exec',
  bun: 'bunx',
} as const satisfies Record<PackageManager, string>;

export const getExecutor = (pm: PackageManager): string => executors[pm];

const runners = {
  pnpm: 'pnpm',
  npm: 'npx',
  yarn: 'yarn',
  bun: 'bunx',
} as const satisfies Record<PackageManager, string>;

export const getRunner = (pm: PackageManager): string => runners[pm];
