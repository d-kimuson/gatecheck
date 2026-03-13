import { describe, test, expect } from 'vitest';
import { presets, reviewPresets } from './presets.ts';
import type { CheckEntry, ReviewEntry } from './types.ts';

type PresetCheck = Omit<CheckEntry, 'name'>;
type PresetReview = Omit<ReviewEntry, 'name'>;

describe('presets', () => {
  test('all presets have unique names', () => {
    const names = presets.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('all presets have non-empty checks', () => {
    for (const preset of presets) {
      expect(Object.keys(preset.checks).length).toBeGreaterThan(0);
    }
  });

  test('all check entries have required fields', () => {
    for (const preset of presets) {
      const checks: Record<string, PresetCheck> = preset.checks;
      for (const check of Object.values(checks)) {
        expect(check.match).toBeTruthy();
        expect(check.command).toBeTruthy();
        expect(check.group).toBeTruthy();
      }
    }
  });

  test('all check names across presets are unique', () => {
    const checkNames = presets.flatMap((p) => Object.keys(p.checks));
    expect(new Set(checkNames).size).toBe(checkNames.length);
  });

  test('contains expected preset names', () => {
    const names = presets.map((p) => p.name);
    expect(names).toContain('prettier');
    expect(names).toContain('oxfmt');
    expect(names).toContain('eslint');
    expect(names).toContain('oxlint');
    expect(names).toContain('biome');
    expect(names).toContain('tsc');
    expect(names).toContain('tsgo');
    expect(names).toContain('vitest');
    expect(names).toContain('jest');
  });

  test('all match patterns are valid regex', () => {
    for (const preset of presets) {
      const checks: Record<string, PresetCheck> = preset.checks;
      for (const check of Object.values(checks)) {
        expect(() => new RegExp(check.match)).not.toThrow();
      }
    }
  });

  test('commands use new template syntax', () => {
    for (const preset of presets) {
      const checks: Record<string, PresetCheck> = preset.checks;
      for (const check of Object.values(checks)) {
        expect(check.command).not.toContain('{{CHANGED_FILES}}');
      }
    }
  });
});

describe('preset regex patterns', () => {
  const jstsExtensions = [
    '.js',
    '.jsx',
    '.mjs',
    '.mjsx',
    '.cjs',
    '.cjsx',
    '.ts',
    '.tsx',
    '.mts',
    '.mtsx',
    '.cts',
    '.ctsx',
  ];
  const tsOnlyExtensions = ['.ts', '.tsx', '.mts', '.mtsx', '.cts', '.ctsx'];
  const nonJsTs = ['.css', '.json', '.md', '.html'];

  const getPattern = (presetName: string): string => {
    const preset = presets.find((p) => p.name === presetName);
    if (preset === undefined) throw new Error(`Preset ${presetName} not found`);
    const checks: Record<string, PresetCheck> = preset.checks;
    const firstCheck = Object.values(checks)[0];
    if (firstCheck === undefined) throw new Error(`No checks in preset ${presetName}`);
    return firstCheck.match;
  };

  const matchesExt = (pattern: string, ext: string): boolean =>
    new RegExp(pattern).test(`src/file${ext}`);

  test('oxfmt matches all JS/TS extensions', () => {
    const pattern = getPattern('oxfmt');
    for (const ext of jstsExtensions) {
      expect(matchesExt(pattern, ext)).toBe(true);
    }
    for (const ext of nonJsTs) {
      expect(matchesExt(pattern, ext)).toBe(false);
    }
  });

  test('eslint matches all JS/TS extensions', () => {
    const pattern = getPattern('eslint');
    for (const ext of jstsExtensions) {
      expect(matchesExt(pattern, ext)).toBe(true);
    }
    for (const ext of nonJsTs) {
      expect(matchesExt(pattern, ext)).toBe(false);
    }
  });

  test('tsc matches TS-only extensions', () => {
    const pattern = getPattern('tsc');
    for (const ext of tsOnlyExtensions) {
      expect(matchesExt(pattern, ext)).toBe(true);
    }
    const jsOnly = ['.js', '.jsx', '.mjs', '.cjs'];
    for (const ext of jsOnly) {
      expect(matchesExt(pattern, ext)).toBe(false);
    }
  });

  test('tsgo matches TS-only extensions', () => {
    const pattern = getPattern('tsgo');
    for (const ext of tsOnlyExtensions) {
      expect(matchesExt(pattern, ext)).toBe(true);
    }
    const jsOnly = ['.js', '.jsx', '.mjs', '.cjs'];
    for (const ext of jsOnly) {
      expect(matchesExt(pattern, ext)).toBe(false);
    }
  });

  test('prettier matches JS/TS + json, css, scss, less, html, md, yaml, yml', () => {
    const pattern = getPattern('prettier');
    for (const ext of jstsExtensions) {
      expect(matchesExt(pattern, ext)).toBe(true);
    }
    for (const ext of ['.json', '.css', '.scss', '.less', '.html', '.md', '.yaml', '.yml']) {
      expect(matchesExt(pattern, ext)).toBe(true);
    }
    expect(matchesExt(pattern, '.png')).toBe(false);
  });

  test('biome matches JS/TS + json, jsonc, css', () => {
    const pattern = getPattern('biome');
    for (const ext of jstsExtensions) {
      expect(matchesExt(pattern, ext)).toBe(true);
    }
    for (const ext of ['.json', '.jsonc', '.css']) {
      expect(matchesExt(pattern, ext)).toBe(true);
    }
    expect(matchesExt(pattern, '.md')).toBe(false);
  });

  test('vitest matches all JS/TS extensions', () => {
    const pattern = getPattern('vitest');
    for (const ext of jstsExtensions) {
      expect(matchesExt(pattern, ext)).toBe(true);
    }
  });

  test('jest matches all JS/TS extensions', () => {
    const pattern = getPattern('jest');
    for (const ext of jstsExtensions) {
      expect(matchesExt(pattern, ext)).toBe(true);
    }
  });
});

describe('reviewPresets', () => {
  test('all review presets have unique names', () => {
    const names = reviewPresets.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('all review presets have non-empty reviews', () => {
    for (const preset of reviewPresets) {
      expect(Object.keys(preset.reviews).length).toBeGreaterThan(0);
    }
  });

  test('all review entries have required fields', () => {
    for (const preset of reviewPresets) {
      const reviews: Record<string, PresetReview> = preset.reviews;
      for (const review of Object.values(reviews)) {
        expect(review.match).toBeTruthy();
        expect(review.command).toBeTruthy();
      }
    }
  });

  test('all review names across presets are unique', () => {
    const reviewNames = reviewPresets.flatMap((p) => Object.keys(p.reviews));
    expect(new Set(reviewNames).size).toBe(reviewNames.length);
  });

  test('contains codex and claude presets', () => {
    const names = reviewPresets.map((p) => p.name);
    expect(names).toContain('codex');
    expect(names).toContain('claude');
  });

  test('review commands use template syntax for vars', () => {
    for (const preset of reviewPresets) {
      const reviews: Record<string, PresetReview> = preset.reviews;
      for (const review of Object.values(reviews)) {
        expect(review.command).toContain('{{ vars.prompt }}');
      }
    }
  });

  test('review vars reference ctx.CHANGED_FILES', () => {
    for (const preset of reviewPresets) {
      const reviews: Record<string, PresetReview> = preset.reviews;
      for (const review of Object.values(reviews)) {
        const promptVar = review.vars?.['prompt'] ?? '';
        expect(promptVar).toContain('{{ ctx.CHANGED_FILES }}');
      }
    }
  });

  test('reviews exclude markdown files', () => {
    for (const preset of reviewPresets) {
      const reviews: Record<string, PresetReview> = preset.reviews;
      for (const review of Object.values(reviews)) {
        expect(review.exclude).toBe('**/*.md');
      }
    }
  });

  test('reviews match any file', () => {
    for (const preset of reviewPresets) {
      const reviews: Record<string, PresetReview> = preset.reviews;
      for (const review of Object.values(reviews)) {
        expect(review.match).toBe('.*');
      }
    }
  });
});
