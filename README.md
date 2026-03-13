# gatecheck

Quality gate for git changes — run deterministic checks and AI-powered reviews against changed files.

In AI-native workflows, agents produce large volumes of code changes. Compound guardrails — type checking, linting, testing — let agents receive automated feedback and self-correct in a tight loop. gatecheck makes this simple: run `gatecheck check` and it executes your configured checks, scoped to only the files that changed. Run `gatecheck review` to get AI-powered code reviews on the same changed files.

Designed for AI agent integration. Ships with built-in support for [Claude Code hooks](https://docs.anthropic.com/en/docs/claude-code/hooks) and [Copilot CLI hooks](https://docs.github.com/en/copilot/reference/cli-command-reference#agentstop--subagentstop-decision-control).

## Install

```sh
pnpm add -D gatecheck
```

## Quick Start

Run the interactive setup to generate a `gatecheck.yaml` config file:

```sh
pnpm gatecheck setup
```

The setup wizard walks you through:

1. **Default changed sources** — Which changed files to check (default: `untracked,unstaged,staged,branch:main`).
2. **Default target groups** — Which check groups to run (default: `all`).
3. **Check presets** — Detects installed dependencies and pre-selects matching presets (prettier, oxfmt, eslint, oxlint, biome, tsc, tsgo, vitest, jest).
4. **Review preset** — Optionally add an AI review (codex or claude).
5. **Agent hooks** — Optionally configure Claude Code Stop hooks or Copilot CLI agentStop hooks.

For non-interactive setup (CI, scripts):

```sh
pnpm gatecheck setup --non-interactive
```

## Commands

### `gatecheck check`

Run deterministic checks (lint, typecheck, test, format) against changed files.

```sh
# Run all checks with config defaults
pnpm gatecheck check

# Specify changed sources and target groups
pnpm gatecheck check --changed staged --target lint,typecheck

# Preview which checks would run
pnpm gatecheck check --dry-run

# Machine-readable output
pnpm gatecheck check --format json
```

**Options:**

| Flag                      | Description                                                                       |
| ------------------------- | --------------------------------------------------------------------------------- |
| `-c, --changed <sources>` | Changed sources (comma-separated). See [Changed Sources](#changed-sources)        |
| `-t, --target <groups>`   | Target groups (comma-separated or `"all"`)                                        |
| `-d, --dry-run`           | Show which checks would run without executing                                     |
| `-f, --format <format>`   | Output format: `text` (default), `json`, `claude-code-hooks`, `copilot-cli-hooks` |

### `gatecheck review`

Run AI-powered code reviews against changed files.

```sh
# Run all configured reviews
pnpm gatecheck review

# Preview review configuration
pnpm gatecheck review --dry-run

# Review changes since main branch
pnpm gatecheck review --changed branch:main
```

**Options:**

| Flag                      | Description                                            |
| ------------------------- | ------------------------------------------------------ |
| `-c, --changed <sources>` | Changed sources (comma-separated)                      |
| `-d, --dry-run`           | Show review config and matched files without executing |

### `gatecheck setup`

Create or update `gatecheck.yaml` interactively.

| Flag                | Description                                         |
| ------------------- | --------------------------------------------------- |
| `--non-interactive` | Skip prompts, auto-detect presets from package.json |

## Configuration

All configuration lives in `gatecheck.yaml` at your project root.

```yaml
defaults:
  changed: untracked,unstaged,staged,branch:main
  target: all

checks:
  - name: typecheck
    match: '\.(m|c)?tsx?$'
    group: typecheck
    command: pnpm exec tsc --noEmit

  - name: eslint
    match: '\.(m|c)?(j|t)sx?$'
    group: lint
    command: pnpm exec eslint {{ ctx.CHANGED_FILES }}

reviews:
  - name: claude-review
    match: '.*'
    exclude: '**/*.md'
    vars:
      prompt: |
        Changed files: {{ ctx.CHANGED_FILES }}

        You are a professional software architect.
        Please review the changes above.
        Point out any design issues, bug risks, or improvements.
    command: claude --permission-mode 'auto' -p {{ vars.prompt }}
    fallbacks:
      - codex exec --sandbox 'workspace-write' {{ vars.prompt }}
```

### Config Reference

**defaults** (optional)

| Field     | Type   | Description                                        |
| --------- | ------ | -------------------------------------------------- |
| `changed` | string | Default changed sources (comma-separated)          |
| `target`  | string | Default target groups (comma-separated or `"all"`) |

**checks[]**

| Field                    | Type   | Required | Description                                       |
| ------------------------ | ------ | -------- | ------------------------------------------------- |
| `name`                   | string | yes      | Unique check identifier                           |
| `match`                  | string | yes      | Regex pattern matched against relative file paths |
| `exclude`                | string | no       | Glob pattern to exclude matched files             |
| `group`                  | string | yes      | Group name for `--target` filtering               |
| `command`                | string | yes      | Shell command to execute (supports templates)     |
| `changedFiles.separator` | string | no       | Separator between file paths (default: `" "`)     |
| `changedFiles.path`      | string | no       | `"relative"` (default) or `"absolute"`            |

**reviews[]**

| Field       | Type     | Required | Description                                        |
| ----------- | -------- | -------- | -------------------------------------------------- |
| `name`      | string   | yes      | Unique review identifier                           |
| `match`     | string   | yes      | Regex pattern matched against relative file paths  |
| `exclude`   | string   | no       | Glob pattern to exclude matched files              |
| `vars`      | map      | no       | Template variables (can reference env, match, ctx) |
| `command`   | string   | yes      | Primary command to execute                         |
| `fallbacks` | string[] | no       | Fallback commands tried in order if primary fails  |

## Template Engine

Commands and vars support `{{ scope.KEY }}` template syntax.

### Scopes

| Scope   | Description                | Example                   |
| ------- | -------------------------- | ------------------------- |
| `env`   | Environment variables      | `{{ env.HOME }}`          |
| `match` | Regex named capture groups | `{{ match.workspace }}`   |
| `ctx`   | Runtime context            | `{{ ctx.CHANGED_FILES }}` |
| `vars`  | User-defined variables     | `{{ vars.prompt }}`       |

### Context Variables

| Variable            | Available in    | Description                                                                   |
| ------------------- | --------------- | ----------------------------------------------------------------------------- |
| `ctx.CHANGED_FILES` | checks, reviews | Space-separated matched file paths. Shell-escaped in checks; plain in reviews |
| `ctx.DIFF_SUMMARY`  | reviews only    | Full git diff output for review context                                       |

### Shell Escaping

In **check commands**, `{{ ctx.CHANGED_FILES }}` contains individually shell-escaped paths (e.g., `'src/file.ts' 'src/other.ts'`), safe for direct use as shell arguments.

In **review commands**, `{{ ctx.CHANGED_FILES }}` contains plain paths (for human-readable prompts). When `{{ vars.* }}` values are substituted into review commands, they are automatically shell-escaped with single quotes. This means you should **not** manually quote `{{ vars.prompt }}` in your command:

```yaml
# Correct — vars are auto-escaped
command: claude -p {{ vars.prompt }}

# Wrong — double-quoting breaks the command
command: claude -p '{{ vars.prompt }}'
```

## Changed Sources

Values for `defaults.changed` and the `--changed` CLI option:

| Value           | Description                           |
| --------------- | ------------------------------------- |
| `untracked`     | New files not yet tracked by git      |
| `unstaged`      | Modified but not staged               |
| `staged`        | Staged for commit                     |
| `branch:<name>` | Changes since branching from `<name>` |
| `sha:<sha>`     | Changes since a specific commit       |

Multiple sources are comma-separated. Changes from all specified sources are combined and deduplicated.

Default (when not specified): `unstaged,staged`.

## Patterns

### Named Capture Groups (Monorepo)

Use regex named capture groups to run commands per workspace:

```yaml
checks:
  - name: typecheck
    match: '^packages/(?<workspace>[^/]+)/.*\.(m|c)?tsx?$'
    group: typecheck
    command: pnpm --filter {{ match.workspace }} typecheck
```

If `packages/app/src/index.ts` and `packages/lib/src/utils.ts` are both changed, the check runs once per workspace: `typecheck[app]` and `typecheck[lib]`.

### Exclude Patterns

Use glob patterns to exclude files from matching:

```yaml
reviews:
  - name: review
    match: '.*'
    exclude: '**/*.{test,spec}.{ts,tsx,js,jsx}'
    command: claude -p {{ vars.prompt }}
```

## AI Agent Integration

### As a guardrail in context

Add a completion check to your `CLAUDE.md` (or equivalent):

````markdown
## Completion Criteria

Before completing the task, run and fix any errors:

```sh
pnpm gatecheck check
```
````

### Claude Code Hooks

Add a `Stop` hook to `.claude/settings.json` — when any check fails, Claude is blocked from stopping:

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "pnpm gatecheck check --format claude-code-hooks"
          }
        ]
      }
    ]
  }
}
```

### Copilot CLI Hooks

Add an `agentStop` hook to `.github/hooks/gatecheck.json`:

```json
{
  "version": 1,
  "hooks": {
    "agentStop": [
      {
        "type": "command",
        "bash": "pnpm gatecheck check --format copilot-cli-hooks"
      }
    ]
  }
}
```

Both formats output nothing on success (agent stops normally) and `{ "decision": "block", "reason": "..." }` on failure (agent continues fixing).

### Output Formats

| Format              | Use case                                     |
| ------------------- | -------------------------------------------- |
| `text`              | Human-readable terminal output (default)     |
| `json`              | Machine-readable structured output for CI/CD |
| `claude-code-hooks` | Claude Code Stop hook integration            |
| `copilot-cli-hooks` | Copilot CLI agentStop hook integration       |

## License

MIT
