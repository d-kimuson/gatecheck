import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import inquirer from 'inquirer';
import * as v from 'valibot';
import { resolveConfigPath, loadConfig, type ConfigSchema } from './config.ts';
import { log } from './logger.ts';
import { detectPackageManager, getExecutor, getRunner } from './pm.ts';
import { presets } from './presets.ts';
import type { CheckConfig } from './types.ts';

export type SetupOptions = {
  readonly nonInteractive?: boolean;
};

type Config = v.InferOutput<typeof ConfigSchema>;
type CheckEntry = Config['checks'][string];

const DEFAULT_CHANGED = 'untracked,unstaged,staged,branch:main';
const DEFAULT_TARGET = 'all';

const promptDefaults = async (existing?: Config['defaults']): Promise<Config['defaults']> => {
  const answers = await inquirer.prompt<{ changed: string; target: string }>([
    {
      type: 'input',
      name: 'changed',
      message: 'Default changed sources (comma-separated):',
      default: existing?.changed ?? DEFAULT_CHANGED,
    },
    {
      type: 'input',
      name: 'target',
      message: "Default target groups (comma-separated or 'all'):",
      default: existing?.target ?? DEFAULT_TARGET,
    },
  ]);
  return { changed: answers.changed, target: answers.target };
};

const resolveDefaults = (existing?: Config['defaults']): Config['defaults'] => ({
  changed: existing?.changed ?? DEFAULT_CHANGED,
  target: existing?.target ?? DEFAULT_TARGET,
});

const presetDependencies: Record<string, readonly string[]> = {
  prettier: ['prettier'],
  oxfmt: ['oxfmt'],
  eslint: ['eslint'],
  oxlint: ['oxlint'],
  biome: ['@biomejs/biome'],
  tsc: ['typescript'],
  tsgo: ['@typescript/native-preview'],
  vitest: ['vitest'],
  jest: ['jest'],
};

const PackageJsonSchema = v.object({
  dependencies: v.optional(v.record(v.string(), v.string())),
  devDependencies: v.optional(v.record(v.string(), v.string())),
});

const readInstalledDeps = async (cwd: string): Promise<ReadonlySet<string>> => {
  try {
    const raw = await readFile(join(cwd, 'package.json'), 'utf-8');
    const json: unknown = JSON.parse(raw);
    const pkg = v.parse(PackageJsonSchema, json);
    const deps = new Set<string>();
    if (pkg.dependencies) {
      for (const name of Object.keys(pkg.dependencies)) deps.add(name);
    }
    if (pkg.devDependencies) {
      for (const name of Object.keys(pkg.devDependencies)) deps.add(name);
    }
    return deps;
  } catch {
    return new Set();
  }
};

const prefixCommand = (command: string, executor: string): string => `${executor} ${command}`;

const isPresetDetected = (
  presetName: string,
  existingNames: ReadonlySet<string>,
  installedDeps: ReadonlySet<string>,
): boolean => {
  const preset = presets.find((p) => p.name === presetName);
  if (preset && Object.keys(preset.checks).some((k) => existingNames.has(k))) return true;
  const deps = presetDependencies[presetName];
  if (deps && deps.some((d) => installedDeps.has(d))) return true;
  return false;
};

const promptPresets = async (
  existingChecks: Record<string, CheckEntry>,
  executor: string,
  installedDeps: ReadonlySet<string>,
): Promise<Record<string, CheckEntry>> => {
  const existingNames = new Set(Object.keys(existingChecks));

  const { selected } = await inquirer.prompt<{ selected: readonly string[] }>([
    {
      type: 'checkbox',
      name: 'selected',
      message: 'Select checks to add:',
      choices: presets.map((p) => ({
        name: `${p.name} - ${p.description}`,
        value: p.name,
        checked: isPresetDetected(p.name, existingNames, installedDeps),
      })),
    },
  ]);

  const entries = selected.flatMap((name) => {
    const preset = presets.find((p) => p.name === name);
    if (!preset) return [];
    const checkEntries: readonly (readonly [string, CheckConfig])[] = Object.entries(preset.checks);
    return checkEntries.map(([checkName, checkConfig]) => {
      const existing: CheckEntry | undefined = existingChecks[checkName];
      return [
        checkName,
        existing ?? { ...checkConfig, command: prefixCommand(checkConfig.command, executor) },
      ] as const;
    });
  });

  return Object.fromEntries(entries);
};

const autoSelectPresets = (
  existingChecks: Record<string, CheckEntry>,
  executor: string,
  installedDeps: ReadonlySet<string>,
): Record<string, CheckEntry> => {
  const existingNames = new Set(Object.keys(existingChecks));

  const entries = presets
    .filter((p) => isPresetDetected(p.name, existingNames, installedDeps))
    .flatMap((preset) => {
      const checkEntries: readonly (readonly [string, CheckConfig])[] = Object.entries(
        preset.checks,
      );
      return checkEntries.map(([checkName, checkConfig]) => {
        const existing: CheckEntry | undefined = existingChecks[checkName];
        return [
          checkName,
          existing ?? { ...checkConfig, command: prefixCommand(checkConfig.command, executor) },
        ] as const;
      });
    });

  return Object.fromEntries(entries);
};

// -- Claude Code hooks --

const StopHookEntrySchema = v.object({
  matcher: v.string(),
  hooks: v.array(
    v.object({
      type: v.string(),
      command: v.string(),
    }),
  ),
});

const ClaudeSettingsSchema = v.looseObject({
  hooks: v.optional(
    v.looseObject({
      Stop: v.optional(v.array(StopHookEntrySchema)),
    }),
  ),
});

const resolveClaudeSettingsPath = (cwd: string): string => join(cwd, '.claude', 'settings.json');

const readClaudeSettings = async (
  path: string,
): Promise<v.InferOutput<typeof ClaudeSettingsSchema>> => {
  try {
    const raw = await readFile(path, 'utf-8');
    const json: unknown = JSON.parse(raw);
    return v.parse(ClaudeSettingsSchema, json);
  } catch {
    return {};
  }
};

const hasStopHook = (
  settings: v.InferOutput<typeof ClaudeSettingsSchema>,
  command: string,
): boolean => {
  const stops = settings.hooks?.Stop ?? [];
  return stops.some((entry) => entry.hooks.some((h) => h.command === command));
};

const promptClaudeCodeHooks = async (cwd: string, runner: string): Promise<void> => {
  const settingsPath = resolveClaudeSettingsPath(cwd);
  const command = `${runner} check-changed run --format claude-code-hooks`;
  const settings = await readClaudeSettings(settingsPath);

  if (hasStopHook(settings, command)) {
    log('Claude Code Stop hook is already configured.');
    return;
  }

  const { enable } = await inquirer.prompt<{ enable: boolean }>([
    {
      type: 'confirm',
      name: 'enable',
      message:
        'Set up Claude Code Stop hook? This runs checks before Claude finishes and blocks it from stopping if any check fails.',
      default: true,
    },
  ]);

  if (!enable) return;

  const hookEntry = {
    matcher: '',
    hooks: [{ type: 'command', command }],
  };

  const existingStop = settings.hooks?.Stop ?? [];
  const updated = {
    ...settings,
    hooks: {
      ...settings.hooks,
      Stop: [...existingStop, hookEntry],
    },
  };

  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(updated, null, 2)}\n`);
  log(`Claude Code hook written to ${settingsPath}`);
};

// -- Copilot CLI hooks --

const CopilotHookEntrySchema = v.object({
  type: v.string(),
  bash: v.string(),
});

const CopilotHooksFileSchema = v.looseObject({
  version: v.number(),
  hooks: v.optional(
    v.looseObject({
      agentStop: v.optional(v.array(CopilotHookEntrySchema)),
    }),
  ),
});

const resolveCopilotHooksPath = (cwd: string): string =>
  join(cwd, '.github', 'hooks', 'check-changed.json');

const readCopilotHooksFile = async (
  path: string,
): Promise<v.InferOutput<typeof CopilotHooksFileSchema>> => {
  try {
    const raw = await readFile(path, 'utf-8');
    const json: unknown = JSON.parse(raw);
    return v.parse(CopilotHooksFileSchema, json);
  } catch {
    return { version: 1 };
  }
};

const hasCopilotAgentStopHook = (
  config: v.InferOutput<typeof CopilotHooksFileSchema>,
  bash: string,
): boolean => {
  const entries = config.hooks?.agentStop ?? [];
  return entries.some((entry) => entry.bash === bash);
};

const promptCopilotCliHooks = async (cwd: string, runner: string): Promise<void> => {
  const hooksPath = resolveCopilotHooksPath(cwd);
  const bash = `${runner} check-changed run --format copilot-cli-hooks`;
  const config = await readCopilotHooksFile(hooksPath);

  if (hasCopilotAgentStopHook(config, bash)) {
    log('Copilot CLI agentStop hook is already configured.');
    return;
  }

  const { enable } = await inquirer.prompt<{ enable: boolean }>([
    {
      type: 'confirm',
      name: 'enable',
      message:
        'Set up Copilot CLI agentStop hook? This runs checks before Copilot finishes and blocks it from stopping if any check fails.',
      default: true,
    },
  ]);

  if (!enable) return;

  const hookEntry = { type: 'command', bash };
  const existingAgentStop = config.hooks?.agentStop ?? [];
  const updated = {
    ...config,
    version: config.version,
    hooks: {
      ...config.hooks,
      agentStop: [...existingAgentStop, hookEntry],
    },
  };

  await mkdir(dirname(hooksPath), { recursive: true });
  await writeFile(hooksPath, `${JSON.stringify(updated, null, 2)}\n`);
  log(`Copilot CLI hook written to ${hooksPath}`);
};

// -- Main --

export const runSetup = async (cwd: string, options?: SetupOptions): Promise<void> => {
  const nonInteractive = options?.nonInteractive === true;

  let existing: Config | undefined;
  try {
    existing = await loadConfig(cwd);
  } catch {
    // No existing config
  }

  log('check-changed setup\n');

  const pm = await detectPackageManager(cwd);
  const executor = getExecutor(pm);
  const runner = getRunner(pm);
  log(`Detected package manager: ${pm}\n`);

  const installedDeps = existing ? new Set<string>() : await readInstalledDeps(cwd);

  const defaults = nonInteractive
    ? resolveDefaults(existing?.defaults)
    : await promptDefaults(existing?.defaults);
  const checks = nonInteractive
    ? autoSelectPresets(existing?.checks ?? {}, executor, installedDeps)
    : await promptPresets(existing?.checks ?? {}, executor, installedDeps);

  const config = {
    $schema: './node_modules/check-changed/config-schema.json',
    defaults,
    checks,
  };
  const configPath = resolveConfigPath(cwd);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  log(`\nConfig written to ${configPath}`);

  if (!nonInteractive) {
    log('');
    await promptClaudeCodeHooks(cwd, runner);

    log('');
    await promptCopilotCliHooks(cwd, runner);
  }
};
