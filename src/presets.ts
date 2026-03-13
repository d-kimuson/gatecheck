import type { CheckEntry, ReviewEntry } from './types.ts';

// Preset check entry without `name` — name is derived from the preset key
type PresetCheck = Omit<CheckEntry, 'name'>;

type CheckPreset = {
  readonly name: string;
  readonly description: string;
  readonly checks: Readonly<Record<string, PresetCheck>>;
};

// Preset review entry without `name` — name is derived from the preset key
type PresetReview = Omit<ReviewEntry, 'name'>;

type ReviewPreset = {
  readonly name: string;
  readonly description: string;
  readonly reviews: Readonly<Record<string, PresetReview>>;
};

export const presets = [
  {
    name: 'prettier',
    description: 'Format with Prettier',
    checks: {
      prettier: {
        match: '\\.((m|c)?(j|t)sx?|json|css|scss|less|html|md|ya?ml)$',
        command: 'prettier --write --no-error-on-unmatched-pattern {{ ctx.CHANGED_FILES }}',
        group: 'format',
      },
    },
  },
  {
    name: 'oxfmt',
    description: 'Format with oxfmt',
    checks: {
      oxfmt: {
        match: '\\.(m|c)?(j|t)sx?$',
        command: 'oxfmt --write --no-error-on-unmatched-pattern {{ ctx.CHANGED_FILES }}',
        group: 'format',
      },
    },
  },
  {
    name: 'eslint',
    description: 'Lint with ESLint',
    checks: {
      eslint: {
        match: '\\.(m|c)?(j|t)sx?$',
        command: 'eslint {{ ctx.CHANGED_FILES }}',
        group: 'lint',
      },
    },
  },
  {
    name: 'oxlint',
    description: 'Lint with oxlint',
    checks: {
      oxlint: {
        match: '\\.(m|c)?(j|t)sx?$',
        command: 'oxlint --type-aware --fix {{ ctx.CHANGED_FILES }}',
        group: 'lint',
      },
    },
  },
  {
    name: 'biome',
    description: 'Lint & format with Biome',
    checks: {
      'biome-format': {
        match: '\\.((m|c)?(j|t)sx?|json|jsonc|css)$',
        command: 'biome format --write {{ ctx.CHANGED_FILES }}',
        group: 'format',
      },
      'biome-check': {
        match: '\\.((m|c)?(j|t)sx?|json|jsonc|css)$',
        command: 'biome check --write {{ ctx.CHANGED_FILES }}',
        group: 'lint',
      },
    },
  },
  {
    name: 'tsc',
    description: 'Type-check with TypeScript compiler',
    checks: {
      typecheck: {
        match: '\\.(m|c)?tsx?$',
        command: 'tsc --noEmit',
        group: 'typecheck',
      },
    },
  },
  {
    name: 'tsgo',
    description: 'Type-check with tsgo (native TypeScript)',
    checks: {
      'typecheck-tsgo': {
        match: '\\.(m|c)?tsx?$',
        command: 'tsgo --noEmit',
        group: 'typecheck',
      },
    },
  },
  {
    name: 'vitest',
    description: 'Run related tests with Vitest',
    checks: {
      vitest: {
        match: '\\.(m|c)?(j|t)sx?$',
        command: 'vitest related --run --passWithNoTests {{ ctx.CHANGED_FILES }}',
        group: 'test',
      },
    },
  },
  {
    name: 'jest',
    description: 'Run related tests with Jest',
    checks: {
      jest: {
        match: '\\.(m|c)?(j|t)sx?$',
        command: 'jest --findRelatedTests --passWithNoTests {{ ctx.CHANGED_FILES }}',
        group: 'test',
      },
    },
  },
] as const satisfies readonly CheckPreset[];

export type CheckPresetName = (typeof presets)[number]['name'];

// -- Review presets --

const REVIEW_PROMPT = [
  'Changed files: {{ ctx.CHANGED_FILES }}',
  '',
  'You are a professional software architect.',
  'Please review the changes above.',
  'Point out any design issues, bug risks, or improvements.',
].join('\n');

export const reviewPresets = [
  {
    name: 'codex',
    description: 'Architecture review with OpenAI Codex',
    reviews: {
      'codex-review': {
        match: '.*',
        exclude: '**/*.md',
        vars: { prompt: REVIEW_PROMPT },
        command: "codex exec --sandbox 'workspace-write' {{ vars.prompt }}",
      },
    },
  },
  {
    name: 'claude',
    description: 'Architecture review with Claude Code',
    reviews: {
      'claude-review': {
        match: '.*',
        exclude: '**/*.md',
        vars: { prompt: REVIEW_PROMPT },
        command: "claude --permission-mode 'auto' -p {{ vars.prompt }}",
      },
    },
  },
] as const satisfies readonly ReviewPreset[];

export type ReviewPresetName = (typeof reviewPresets)[number]['name'];
