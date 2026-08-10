#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');
const changelogPath = join(repoRoot, 'CHANGELOG.md');
const packageJsonPath = join(repoRoot, 'package.json');

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version ?? '0.0.0';
const stamp = new Date().toISOString().slice(0, 10);

function getRecentHistory() {
  try {
    const output = execFileSync(
      'git',
      ['log', '-n', '8', '--date=short', '--pretty=format:%ad%x09%s', '--no-merges'],
      { cwd: repoRoot, encoding: 'utf8' }
    );
    return output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [date, ...rest] = line.split('\t');
        return `- ${rest.join('\t')} (${date})`;
      });
  } catch {
    return ['- No git history available in this checkout.'];
  }
}

const entry = [
  `## ${version} - ${stamp}`,
  '',
  '### Ship summary',
  `- Release hardening pass for ${version}: changelog automation, CI checks, and QA documentation are now wired into the shipping path.`,
  '',
  '### Recent changes',
  ...getRecentHistory(),
  ''
].join('\n');

let existing = '';
if (existsSync(changelogPath)) {
  existing = readFileSync(changelogPath, 'utf8').trim();
}

if (existing.includes(`## ${version} -`)) {
  console.log(`CHANGELOG already contains ${version}; leaving it as-is.`);
  process.exit(0);
}

const body = existing.replace(/^# Changelog\s*/m, '').trim();
const nextContent = `# Changelog\n\n${entry}${body ? `\n${body}\n` : ''}`;
writeFileSync(changelogPath, nextContent, 'utf8');
console.log(`Updated ${changelogPath} with a new ${version} entry.`);
