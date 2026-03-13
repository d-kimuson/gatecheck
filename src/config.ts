import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as v from 'valibot';
import { parse as parseYaml } from 'yaml';

// -- Schema --

const ChangedFilesSchema = v.object({
  separator: v.optional(v.string()),
  path: v.optional(v.picklist(['relative', 'absolute'])),
});

const CheckEntrySchema = v.object({
  name: v.string(),
  match: v.string(),
  exclude: v.optional(v.string()),
  group: v.string(),
  command: v.string(),
  changedFiles: v.optional(ChangedFilesSchema),
});

const ReviewEntrySchema = v.object({
  name: v.string(),
  match: v.string(),
  exclude: v.optional(v.string()),
  vars: v.optional(v.record(v.string(), v.string())),
  prompt: v.optional(v.string()),
  command: v.string(),
  fallbacks: v.optional(v.array(v.string())),
});

const DefaultsSchema = v.object({
  changed: v.optional(v.string()),
  target: v.optional(v.string()),
});

export const GatecheckConfigSchema = v.object({
  defaults: v.optional(DefaultsSchema),
  checks: v.optional(v.array(CheckEntrySchema)),
  reviews: v.optional(v.array(ReviewEntrySchema)),
});

// -- Config file path --

const CONFIG_FILENAME = 'gatecheck.yaml';

export const resolveConfigPath = (cwd: string): string => resolve(cwd, CONFIG_FILENAME);

// -- Load & validate --

export class ConfigNotFoundError extends Error {
  constructor(configPath: string) {
    super(`Config file not found: ${configPath}\nRun \`gatecheck setup\` to create one.`);
    this.name = 'ConfigNotFoundError';
  }
}

export const loadConfig = async (
  cwd: string,
): Promise<v.InferOutput<typeof GatecheckConfigSchema>> => {
  const configPath = resolveConfigPath(cwd);
  let raw: string;
  try {
    raw = await readFile(configPath, 'utf-8');
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      throw new ConfigNotFoundError(configPath);
    }
    throw err;
  }
  const parsed: unknown = parseYaml(raw);
  return v.parse(GatecheckConfigSchema, parsed);
};
