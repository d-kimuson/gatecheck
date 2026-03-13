import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as v from 'valibot';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, resolveConfigPath, GatecheckConfigSchema } from './config.ts';

describe('resolveConfigPath', () => {
  test('resolves gatecheck.yaml in given directory', () => {
    expect(resolveConfigPath('/foo/bar')).toBe('/foo/bar/gatecheck.yaml');
  });
});

describe('GatecheckConfigSchema', () => {
  test('validates a valid config with checks', () => {
    const input = {
      checks: [{ name: 'lint', match: '\\.ts$', group: 'lint', command: 'eslint' }],
    };
    expect(() => v.parse(GatecheckConfigSchema, input)).not.toThrow();
  });

  test('validates a valid config with reviews', () => {
    const input = {
      reviews: [
        {
          name: 'architect',
          match: 'src/.*',
          vars: { prompt: '{{ ctx.DIFF_SUMMARY }}' },
          command: 'codex -p "{{ vars.prompt }}"',
          fallbacks: ['claude -p "{{ vars.prompt }}"'],
        },
      ],
    };
    expect(() => v.parse(GatecheckConfigSchema, input)).not.toThrow();
  });

  test('accepts empty config', () => {
    const input = {};
    expect(() => v.parse(GatecheckConfigSchema, input)).not.toThrow();
  });

  test('rejects check entry missing required fields', () => {
    const input = {
      checks: [{ name: 'lint', match: '\\.ts$' }],
    };
    expect(() => v.parse(GatecheckConfigSchema, input)).toThrow(/Invalid/i);
  });

  test('validates config with defaults', () => {
    const input = {
      defaults: {
        changed: 'staged',
        target: 'lint,test',
      },
      checks: [{ name: 'lint', match: '\\.ts$', group: 'lint', command: 'eslint' }],
    };
    expect(() => v.parse(GatecheckConfigSchema, input)).not.toThrow();
  });

  test('validates config with partial defaults', () => {
    const input = {
      defaults: { changed: 'branch:main' },
    };
    expect(() => v.parse(GatecheckConfigSchema, input)).not.toThrow();
  });

  test('validates check entry with changedFiles options', () => {
    const input = {
      checks: [
        {
          name: 'lint',
          match: '\\.ts$',
          group: 'lint',
          command: 'eslint {{ ctx.CHANGED_FILES }}',
          changedFiles: { separator: '\\n', path: 'absolute' },
        },
      ],
    };
    expect(() => v.parse(GatecheckConfigSchema, input)).not.toThrow();
  });
});

describe('loadConfig', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gatecheck-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  test('loads and validates a YAML config file', async () => {
    const yaml = `
checks:
  - name: lint
    match: '\\.ts$'
    group: lint
    command: eslint
`;
    await writeFile(join(dir, 'gatecheck.yaml'), yaml);

    const result = await loadConfig(dir);
    expect(result.checks).toHaveLength(1);
    expect(result.checks?.[0]?.name).toBe('lint');
  });

  test('throws ConfigNotFoundError on missing file', async () => {
    await expect(loadConfig(dir)).rejects.toThrow(/Config file not found/);
  });
});
