// Template engine for {{ scope.KEY }} syntax
// Resolution order: env → match → ctx → vars
// vars can reference env, match, ctx but NOT other vars

const TEMPLATE_PATTERN = /\{\{\s*(\w+)\.(\w+)\s*\}\}/g;

type TemplateContext = {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly match: Readonly<Record<string, string>>;
  readonly ctx: Readonly<Record<string, string>>;
  readonly vars: Readonly<Record<string, string>>;
};

const lookupValue = (scope: string, key: string, context: TemplateContext): string | undefined => {
  switch (scope) {
    case 'env':
      return context.env[key];
    case 'match':
      return context.match[key];
    case 'ctx':
      return context.ctx[key];
    case 'vars':
      return context.vars[key];
    default:
      return undefined;
  }
};

const resolveTemplate = (template: string, context: TemplateContext): string =>
  template.replaceAll(TEMPLATE_PATTERN, (original, scope: string, key: string) => {
    const value = lookupValue(scope, key, context);
    return value ?? original;
  });

// Resolve vars first (they can reference env, match, ctx but not other vars)
// Then resolve the final template with all scopes available
export const resolveVars = (
  vars: Readonly<Record<string, string>>,
  baseContext: Omit<TemplateContext, 'vars'>,
): Readonly<Record<string, string>> => {
  const resolved: Record<string, string> = {};
  const contextForVars: TemplateContext = { ...baseContext, vars: {} };

  for (const [key, value] of Object.entries(vars)) {
    resolved[key] = resolveTemplate(value, contextForVars);
  }

  return resolved;
};

export const resolve = (template: string, context: TemplateContext): string =>
  resolveTemplate(template, context);

// Resolve template with auto-shell-escaping for vars scope.
// Use this when substituting vars into shell command strings.
export const resolveCommand = (template: string, context: TemplateContext): string =>
  template.replaceAll(TEMPLATE_PATTERN, (original, scope: string, key: string) => {
    const value = lookupValue(scope, key, context);
    if (value === undefined) return original;
    return scope === 'vars' ? shellEscape(value) : value;
  });

// eslint-disable-next-line node/no-process-env -- env access is intentional for template resolution
const getEnv = (): Readonly<Record<string, string | undefined>> => process.env;

// Shell-safe escaping using single quotes (POSIX-compliant)
export const shellEscape = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

export const buildContext = (overrides: {
  match?: Readonly<Record<string, string>>;
  ctx?: Readonly<Record<string, string>>;
  vars?: Readonly<Record<string, string>>;
}): TemplateContext => ({
  env: getEnv(),
  match: overrides.match ?? {},
  ctx: overrides.ctx ?? {},
  vars: overrides.vars ?? {},
});
