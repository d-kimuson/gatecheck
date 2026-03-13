import { describe, test, expect } from 'vitest';
import { resolve, resolveVars, buildContext } from './template.ts';

describe('resolve', () => {
  test('replaces env variables', () => {
    const context = buildContext({});
    // eslint-disable-next-line node/no-process-env -- test needs to verify env access
    const home = process.env['HOME'] ?? '';
    const result = resolve('home is {{ env.HOME }}', context);
    expect(result).toBe(`home is ${home}`);
  });

  test('replaces ctx variables', () => {
    const context = buildContext({ ctx: { CHANGED_FILES: 'a.ts b.ts' } });
    expect(resolve('files: {{ ctx.CHANGED_FILES }}', context)).toBe('files: a.ts b.ts');
  });

  test('replaces match variables', () => {
    const context = buildContext({ match: { name: 'app' } });
    expect(resolve('pkg={{ match.name }}', context)).toBe('pkg=app');
  });

  test('replaces vars variables', () => {
    const context = buildContext({ vars: { prompt: 'hello world' } });
    expect(resolve('{{ vars.prompt }}', context)).toBe('hello world');
  });

  test('leaves unknown scopes unreplaced', () => {
    const context = buildContext({});
    expect(resolve('{{ unknown.KEY }}', context)).toBe('{{ unknown.KEY }}');
  });

  test('leaves missing keys unreplaced', () => {
    const context = buildContext({ ctx: {} });
    expect(resolve('{{ ctx.MISSING }}', context)).toBe('{{ ctx.MISSING }}');
  });

  test('handles multiple replacements', () => {
    const context = buildContext({ match: { a: '1', b: '2' } });
    expect(resolve('{{ match.a }}-{{ match.b }}', context)).toBe('1-2');
  });
});

describe('resolveVars', () => {
  test('resolves vars using ctx and match', () => {
    const baseContext = {
      env: {},
      match: { name: 'app' },
      ctx: { DIFF_SUMMARY: 'some diff' },
    };
    const vars = {
      prompt: '{{ ctx.DIFF_SUMMARY }}\nReview {{ match.name }}',
    };
    const resolved = resolveVars(vars, baseContext);
    expect(resolved['prompt']).toBe('some diff\nReview app');
  });

  test('vars cannot reference other vars', () => {
    const baseContext = {
      env: {},
      match: {},
      ctx: {},
    };
    const vars = {
      a: 'hello',
      b: '{{ vars.a }} world',
    };
    const resolved = resolveVars(vars, baseContext);
    // vars.a is not available during vars resolution
    expect(resolved['b']).toBe('{{ vars.a }} world');
  });
});
