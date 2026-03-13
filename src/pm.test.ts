import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { detectPackageManager, getExecutor } from './pm.ts';

describe('detectPackageManager', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gatecheck-pm-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  test('detects pnpm from pnpm-lock.yaml', async () => {
    await writeFile(join(dir, 'pnpm-lock.yaml'), '');
    expect(await detectPackageManager(dir)).toBe('pnpm');
  });

  test('detects npm from package-lock.json', async () => {
    await writeFile(join(dir, 'package-lock.json'), '');
    expect(await detectPackageManager(dir)).toBe('npm');
  });

  test('detects yarn from yarn.lock', async () => {
    await writeFile(join(dir, 'yarn.lock'), '');
    expect(await detectPackageManager(dir)).toBe('yarn');
  });

  test('detects bun from bun.lockb', async () => {
    await writeFile(join(dir, 'bun.lockb'), '');
    expect(await detectPackageManager(dir)).toBe('bun');
  });

  test('detects bun from bun.lock', async () => {
    await writeFile(join(dir, 'bun.lock'), '');
    expect(await detectPackageManager(dir)).toBe('bun');
  });

  test('defaults to npm when no lockfile found', async () => {
    expect(await detectPackageManager(dir)).toBe('npm');
  });

  test('prefers pnpm over npm when both lockfiles exist', async () => {
    await writeFile(join(dir, 'pnpm-lock.yaml'), '');
    await writeFile(join(dir, 'package-lock.json'), '');
    expect(await detectPackageManager(dir)).toBe('pnpm');
  });
});

describe('getExecutor', () => {
  test('returns pnpm exec for pnpm', () => {
    expect(getExecutor('pnpm')).toBe('pnpm exec');
  });

  test('returns npx for npm', () => {
    expect(getExecutor('npm')).toBe('npx');
  });

  test('returns yarn exec for yarn', () => {
    expect(getExecutor('yarn')).toBe('yarn exec');
  });

  test('returns bunx for bun', () => {
    expect(getExecutor('bun')).toBe('bunx');
  });
});
