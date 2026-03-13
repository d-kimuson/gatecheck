import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as v from 'valibot';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { GatecheckConfigSchema } from './config.ts';
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

const readYamlConfig = async (
  dir: string,
): Promise<v.InferOutput<typeof GatecheckConfigSchema>> => {
  const raw = await readFile(join(dir, 'gatecheck.yaml'), 'utf-8');
  const parsed: unknown = parseYaml(raw);
  return v.parse(GatecheckConfigSchema, parsed);
};

const readJsonFile = async (path: string): Promise<unknown> => {
  const raw = await readFile(path, 'utf-8');
  return JSON.parse(raw) as unknown;
};

describe('runSetup --non-interactive', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gatecheck-setup-'));
    // Create pnpm-lock.yaml so detectPackageManager returns 'pnpm'
    await writeFile(join(dir, 'pnpm-lock.yaml'), '');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  test('creates YAML config with detected presets from package.json', async () => {
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        devDependencies: { typescript: '^5.0.0', oxlint: '^1.0.0' },
      }),
    );

    await runSetup(dir, { nonInteractive: true });

    const config = await readYamlConfig(dir);

    expect(config.defaults).toEqual({
      changed: 'untracked,unstaged,staged,branch:main',
      target: 'all',
    });
    expect(config.checks).toBeDefined();
    const checkNames = config.checks?.map((c) => c.name) ?? [];
    expect(checkNames).toContain('typecheck');
    expect(checkNames).toContain('oxlint');

    const typecheck = config.checks?.find((c) => c.name === 'typecheck');
    expect(typecheck?.command).toMatch(/^pnpm exec /);
  });

  test('creates config with no checks when no deps detected', async () => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({}));

    await runSetup(dir, { nonInteractive: true });

    const config = await readYamlConfig(dir);

    expect(config.defaults).toEqual({
      changed: 'untracked,unstaged,staged,branch:main',
      target: 'all',
    });
    expect(config.checks ?? []).toHaveLength(0);
  });

  test('does not create Claude Code hook in non-interactive mode', async () => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({}));

    await runSetup(dir, { nonInteractive: true });

    await expect(readJsonFile(join(dir, '.claude', 'settings.json'))).rejects.toThrow(/ENOENT/);
  });

  test('does not create Copilot CLI hook in non-interactive mode', async () => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({}));

    await runSetup(dir, { nonInteractive: true });

    await expect(readJsonFile(join(dir, '.github', 'hooks', 'gatecheck.json'))).rejects.toThrow(
      /ENOENT/,
    );
  });

  test('preserves existing config defaults when updating', async () => {
    const existingYaml = [
      'defaults:',
      '  changed: staged',
      '  target: lint',
      'checks:',
      '  - name: eslint',
      "    match: '\\\\.(m|c)?(j|t)sx?$'",
      '    group: lint',
      '    command: pnpm exec eslint {{ ctx.CHANGED_FILES }}',
    ].join('\n');
    await writeFile(join(dir, 'gatecheck.yaml'), existingYaml);

    await runSetup(dir, { nonInteractive: true });

    const config = await readYamlConfig(dir);

    // Existing defaults are preserved
    expect(config.defaults).toEqual({ changed: 'staged', target: 'lint' });
    // Existing check is preserved
    const eslint = config.checks?.find((c) => c.name === 'eslint');
    expect(eslint?.command).toBe('pnpm exec eslint {{ ctx.CHANGED_FILES }}');
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
                command: 'pnpm gatecheck check --format claude-code-hooks',
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

  test('preserves existing reviews in non-interactive mode', async () => {
    const existingYaml = [
      'reviews:',
      '  - name: codex-review',
      "    match: 'src/.*'",
      "    command: codex exec --sandbox 'workspace-write' 'review this'",
    ].join('\n');
    await writeFile(join(dir, 'gatecheck.yaml'), existingYaml);

    await runSetup(dir, { nonInteractive: true });

    const config = await readYamlConfig(dir);
    expect(config.reviews).toHaveLength(1);
    expect(config.reviews?.[0]?.name).toBe('codex-review');
  });

  test('omits reviews key when no reviews selected in non-interactive mode', async () => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({}));

    await runSetup(dir, { nonInteractive: true });

    const raw = await readFile(join(dir, 'gatecheck.yaml'), 'utf-8');
    expect(raw).not.toContain('reviews:');
  });

  test('uses new template syntax in preset commands', async () => {
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ devDependencies: { vitest: '^3.0.0' } }),
    );

    await runSetup(dir, { nonInteractive: true });

    const config = await readYamlConfig(dir);
    const vitest = config.checks?.find((c) => c.name === 'vitest');
    expect(vitest?.command).toContain('{{ ctx.CHANGED_FILES }}');
    expect(vitest?.command).not.toContain('{{CHANGED_FILES}}');
  });
});
