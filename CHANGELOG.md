# Changelog

## 0.0.1-beta.2

## 0.0.1-beta.1

### &nbsp;&nbsp;&nbsp;Features

- Run checks against git-changed files with regex pattern matching and `{{CHANGED_FILES}}` placeholder injection &nbsp;-&nbsp; by **d-kimuson** [<samp>(235e4)</samp>](https://github.com/d-kimuson/check-changed/commit/235e415)
- Support multiple changed sources: `untracked`, `unstaged`, `staged`, `branch:<name>`, `sha:<sha>` (comma-separated) &nbsp;-&nbsp; by **d-kimuson** [<samp>(235e4)</samp>](https://github.com/d-kimuson/check-changed/commit/235e415)
- Named capture groups in patterns for grouped parallel execution &nbsp;-&nbsp; by **d-kimuson** [<samp>(235e4)</samp>](https://github.com/d-kimuson/check-changed/commit/235e415)
- `--target` option to filter checks by group, `--dry-run` to preview without executing &nbsp;-&nbsp; by **d-kimuson** [<samp>(235e4)</samp>](https://github.com/d-kimuson/check-changed/commit/235e415)
- Output formats: `text`, `json`, `claude-code-hooks`, `copilot-cli-hooks` &nbsp;-&nbsp; by **d-kimuson** [<samp>(235e4)</samp>](https://github.com/d-kimuson/check-changed/commit/235e415)
- Built-in presets for prettier, oxfmt, eslint, oxlint, biome, tsc, tsgo, vitest, jest &nbsp;-&nbsp; by **d-kimuson** [<samp>(235e4)</samp>](https://github.com/d-kimuson/check-changed/commit/235e415)
- Interactive `setup` command with package manager detection, preset auto-detection from dependencies, and Claude Code / Copilot CLI hook configuration &nbsp;-&nbsp; by **d-kimuson** [<samp>(235e4)</samp>](https://github.com/d-kimuson/check-changed/commit/235e415)
- JSON Schema for `.check-changedrc.json` with editor autocompletion support &nbsp;-&nbsp; by **d-kimuson** [<samp>(235e4)</samp>](https://github.com/d-kimuson/check-changed/commit/235e415)
- Add `--non-interactive` option to setup command &nbsp;-&nbsp; by **d-kimuson** and **Claude Opus 4.6** [<samp>(255d8)</samp>](https://github.com/d-kimuson/check-changed/commit/255d8c1)

##### &nbsp;&nbsp;&nbsp;&nbsp;[View changes on GitHub](https://github.com/d-kimuson/check-changed/compare/7d7f694cebf91e6f613e84edb8555232b0643186...0.0.1-beta.1)
