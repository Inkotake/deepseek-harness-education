import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = path.join(root, 'skills');

const required = ['teaching-aid', 'teaching-slides', 'latex-document', 'lesson-planning', 'question-writing', 'data-visualization', 'publish-static'];
const errors = [];
const existing = fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];

for (const name of required) {
  const dir = path.join(skillsDir, name);
  const skill = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(skill)) {
    errors.push(`Missing SKILL.md for ${name}`);
    continue;
  }
  const text = fs.readFileSync(skill, 'utf8');
  if (!/^---\s*\n/.test(text)) errors.push(`${name}: missing YAML frontmatter`);
  const nameMatch = text.match(/^name:\s*([^\n]+)/m);
  const descMatch = text.match(/^description:\s*([^\n]+)/m);
  if (!nameMatch) errors.push(`${name}: missing name`);
  if (!descMatch) errors.push(`${name}: missing description`);
  if (nameMatch && nameMatch[1].trim() !== name) errors.push(`${name}: name field mismatch: ${nameMatch[1].trim()}`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`verify-skills: OK (${required.length} skills)`);