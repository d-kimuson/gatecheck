import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as v from 'valibot';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { ConfigSchema } from './config.ts';
import { runSetup } from './setup.ts';

const HooksStopSchema = v.object({
  hooks: v.object({
    Stop: v.array(
      v.object({
        matcher: v.string(),
        hooks: v.array(v.object({ type: v.string(), command: v.string() })),
      }),
    ),
  }),
});



const readJsonFile = async (path: string): Promise<unknown> => {
  const raw = await readFile(path, 'utf-8');
  return JSON.parse(raw) as unknown;
};

describe('runSetup --non-interactive', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'check-changed-setup-'));
    // Create pnpm-lock.yaml so detectPackageManager returns 'pnpm'
    await writeFile(join(dir, 'pnpm-lock.yaml'), '');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  test('creates config with detected presets from package.json', async () => {
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        devDependencies: { typescript: '^5.0.0', oxlint: '^1.0.0' },
      }),
    );

    await runSetup(dir, { nonInteractive: true });

    const json = await readJsonFile(join(dir, '.check-changedrc.json'));
    const config = v.parse(ConfigSchema, json);

    expect(config.defaults).toEqual({
      changed: 'untracked,unstaged,staged,branch:main',
      target: 'all',
    });
    expect(config.checks).toHaveProperty('typecheck');
    expect(config.checks).toHaveProperty('oxlint');
    expect(config.checks['typecheck']?.command).toMatch(/^pnpm exec /);
  });

  test('creates config with no checks when no deps detected', async () => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({}));

    await runSetup(dir, { nonInteractive: true });

    const json = await readJsonFile(join(dir, '.check-changedrc.json'));
    const config = v.parse(ConfigSchema, json);

    expect(config.defaults).toEqual({
      changed: 'untracked,unstaged,staged,branch:main',
      target: 'all',
    });
    expect(Object.keys(config.checks)).toHaveLength(0);
  });

  test('does not create Claude Code hook in non-interactive mode', async () => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({}));

    await runSetup(dir, { nonInteractive: true });

    await expect(readJsonFile(join(dir, '.claude', 'settings.json'))).rejects.toThrow();
  });

  test('does not create Copilot CLI hook in non-interactive mode', async () => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({}));

    await runSetup(dir, { nonInteractive: true });

    await expect(
      readJsonFile(join(dir, '.github', 'hooks', 'check-changed.json')),
    ).rejects.toThrow();
  });

  test('preserves existing config defaults when updating', async () => {
    const existingConfig = {
      defaults: { changed: 'staged', target: 'lint' },
      checks: {
        eslint: {
          pattern: '\\.(m|c)?(j|t)sx?$',
          command: 'pnpm exec eslint {{CHANGED_FILES}}',
          group: 'lint',
        },
      },
    };
    await writeFile(join(dir, '.check-changedrc.json'), JSON.stringify(existingConfig));

    await runSetup(dir, { nonInteractive: true });

    const json = await readJsonFile(join(dir, '.check-changedrc.json'));
    const config = v.parse(ConfigSchema, json);

    // Existing defaults are preserved
    expect(config.defaults).toEqual({ changed: 'staged', target: 'lint' });
    // Existing check is preserved
    expect(config.checks['eslint']?.command).toBe('pnpm exec eslint {{CHANGED_FILES}}');
  });

  test('skips Claude Code hook when already configured', async () => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({}));

    const settingsDir = join(dir, '.claude');
    await mkdir(settingsDir, { recursive: true });
    const existingSettings = {
      hooks: {
        Stop: [
          {
            matcher: '',
            hooks: [
              {
                type: 'command',
                command: 'pnpm check-changed run --format claude-code-hooks',
              },
            ],
          },
        ],
      },
    };
    await writeFile(join(settingsDir, 'settings.json'), JSON.stringify(existingSettings));

    await runSetup(dir, { nonInteractive: true });

    const json = await readJsonFile(join(settingsDir, 'settings.json'));
    const settings = v.parse(HooksStopSchema, json);

    // Should not duplicate the hook
    expect(settings.hooks.Stop).toHaveLength(1);
  });
});
