import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const execFileAsync = promisify(execFile);

const tsxPath = join(process.cwd(), 'node_modules', '.bin', 'tsx');
const cliPath = join(process.cwd(), 'src', 'bin.ts');

const runCli = async (
  cwd: string,
  args: readonly string[],
): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> => {
  try {
    const { stdout, stderr } = await execFileAsync(tsxPath, [cliPath, ...args], { cwd });
    return { code: 0, stdout, stderr };
  } catch (error) {
    if (error instanceof Error && 'code' in error && 'stdout' in error && 'stderr' in error) {
      return {
        code: typeof error.code === 'number' ? error.code : 1,
        stdout: typeof error.stdout === 'string' ? error.stdout : '',
        stderr: typeof error.stderr === 'string' ? error.stderr : '',
      };
    }

    throw error;
  }
};

describe('gatecheck CLI', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gatecheck-bin-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('check command shows error when no config file', async () => {
    const result = await runCli(dir, ['check']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Config file not found');
  });

  test('check command reports no checks when config has none', async () => {
    const yaml = `checks: []\n`;
    await writeFile(join(dir, 'gatecheck.yaml'), yaml);
    const result = await runCli(dir, ['check']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('No checks configured');
  });
});
