#!/usr/bin/env tsx

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import inquirer from 'inquirer';

const root = join(import.meta.dirname, '..');

const run = (cmd: string): string => execSync(cmd, { cwd: root, encoding: 'utf-8' }).trim();

const runOrFail = (cmd: string, label: string): void => {
  try {
    execSync(cmd, { cwd: root, stdio: 'inherit' });
  } catch {
    console.error(`\n✗ ${label} failed. Aborting release.`);
    process.exit(1);
  }
};

// -- Read current version --

const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };
const current = pkg.version;

console.log(`Current version: ${current}\n`);

// -- Check clean working tree --

const status = run('git status --porcelain');
if (status !== '') {
  console.error('✗ Working tree is not clean. Commit or stash changes first.');
  process.exit(1);
}

// -- Check signing config --

const gpgFormat = run('git config --get gpg.format').toLowerCase();
const commitSign = run('git config --get commit.gpgsign').toLowerCase();
const tagSign = run('git config --get tag.gpgsign').toLowerCase();

if (gpgFormat !== 'ssh' || commitSign !== 'true' || tagSign !== 'true') {
  console.error('✗ Git signing is not configured. Required:');
  console.error('  git config --global gpg.format ssh');
  console.error('  git config --global commit.gpgsign true');
  console.error('  git config --global tag.gpgsign true');
  process.exit(1);
}

// -- Prompt version --

const bumpChoices = (v: string): { name: string; value: string }[] => {
  const parts = v.split('-');
  const [major, minor, patch] = (parts[0] ?? '').split('.').map(Number) as [number, number, number];
  const pre = parts[1]; // e.g. "beta.5"

  const choices: { name: string; value: string }[] = [];

  if (pre !== undefined) {
    // Currently a prerelease — offer next prerelease + graduate
    const preParts = pre.split('.');
    const preNum = Number(preParts[1] ?? 0);
    const preTag = preParts[0] ?? 'beta';
    choices.push({
      name: `${major}.${minor}.${patch}-${preTag}.${preNum + 1} (pre-${preTag})`,
      value: `${major}.${minor}.${patch}-${preTag}.${preNum + 1}`,
    });
    choices.push({
      name: `${major}.${minor}.${patch} (graduate)`,
      value: `${major}.${minor}.${patch}`,
    });
  }

  choices.push(
    { name: `${major}.${minor}.${patch + 1} (patch)`, value: `${major}.${minor}.${patch + 1}` },
    { name: `${major}.${minor + 1}.0 (minor)`, value: `${major}.${minor + 1}.0` },
    { name: `${major + 1}.0.0 (major)`, value: `${major + 1}.0.0` },
  );

  return choices;
};

const { version } = await inquirer.prompt<{ version: string }>([
  {
    type: 'list',
    name: 'version',
    message: 'Select release version:',
    choices: [...bumpChoices(current), { name: 'Custom', value: 'custom' }],
  },
]);

const nextVersion =
  version === 'custom'
    ? (
        await inquirer.prompt<{ custom: string }>([
          { type: 'input', name: 'custom', message: 'Enter version:' },
        ])
      ).custom
    : version;

const tag = `v${nextVersion}`;

// -- Confirm --

const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
  {
    type: 'confirm',
    name: 'confirmed',
    message: `Release ${tag}? This will commit, tag (signed), and push.`,
    default: false,
  },
]);

if (!confirmed) {
  console.log('Aborted.');
  process.exit(0);
}

// -- Update package.json --

pkg.version = nextVersion;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`\nUpdated package.json to ${nextVersion}`);

// -- Signed commit + signed tag --

run(`git add package.json`);
runOrFail(`git commit -S -m "chore: release ${tag}"`, 'Signed commit');
runOrFail(`git tag -s ${tag} -m ${tag}`, 'Signed tag');

console.log(`\nCreated signed commit and tag ${tag}`);

// -- Push --

runOrFail('git push', 'Push commits');
runOrFail('git push --tags', 'Push tags');

console.log(`\n✓ Released ${tag} — GitHub Actions will publish to npm.`);
