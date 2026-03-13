import { describe, test, expect } from 'vitest';
import { resolve, resolveCommand, resolveVars, buildContext, shellEscape } from './template.ts';

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

describe('resolveCommand', () => {
  test('auto-shell-escapes vars values', () => {
    const context = buildContext({ vars: { prompt: 'hello world' } });
    expect(resolveCommand('cmd -p {{ vars.prompt }}', context)).toBe("cmd -p 'hello world'");
  });

  test('auto-shell-escapes vars with single quotes', () => {
    const context = buildContext({ vars: { prompt: "it's a test" } });
    expect(resolveCommand('cmd -p {{ vars.prompt }}', context)).toBe("cmd -p 'it'\\''s a test'");
  });

  test('auto-shell-escapes multiline vars', () => {
    const context = buildContext({ vars: { prompt: 'line1\nline2' } });
    expect(resolveCommand('cmd -p {{ vars.prompt }}', context)).toBe("cmd -p 'line1\nline2'");
  });

  test('does not shell-escape ctx values', () => {
    const context = buildContext({ ctx: { CHANGED_FILES: 'a.ts b.ts' } });
    expect(resolveCommand('cmd {{ ctx.CHANGED_FILES }}', context)).toBe('cmd a.ts b.ts');
  });

  test('does not shell-escape env values', () => {
    const context = buildContext({});
    // eslint-disable-next-line node/no-process-env -- test needs to verify env access
    const home = process.env['HOME'] ?? '';
    expect(resolveCommand('home={{ env.HOME }}', context)).toBe(`home=${home}`);
  });

  test('review-style: prompt with file list embeds correctly', () => {
    const prompt = 'Changed files: a.ts b.ts\nReview these changes.';
    const context = buildContext({ vars: { prompt } });
    const result = resolveCommand('claude -p {{ vars.prompt }}', context);
    expect(result).toBe("claude -p 'Changed files: a.ts b.ts\nReview these changes.'");
  });
});

describe('shellEscape', () => {
  test('wraps simple string in single quotes', () => {
    expect(shellEscape('hello world')).toBe("'hello world'");
  });

  test('escapes single quotes within value', () => {
    expect(shellEscape("it's a test")).toBe("'it'\\''s a test'");
  });

  test('handles multiple single quotes', () => {
    expect(shellEscape("don't say 'hello'")).toBe("'don'\\''t say '\\''hello'\\'''");
  });

  test('handles empty string', () => {
    expect(shellEscape('')).toBe("''");
  });

  test('handles multiline string', () => {
    const input = 'line1\nline2\nline3';
    const escaped = shellEscape(input);
    expect(escaped).toBe("'line1\nline2\nline3'");
  });

  test('handles string with special shell characters', () => {
    const input = 'echo $HOME && rm -rf /';
    const escaped = shellEscape(input);
    // Single quotes prevent shell expansion
    expect(escaped).toBe("'echo $HOME && rm -rf /'");
  });

  test('handles Japanese characters', () => {
    const input = 'レビューしてください';
    expect(shellEscape(input)).toBe("'レビューしてください'");
  });
});
