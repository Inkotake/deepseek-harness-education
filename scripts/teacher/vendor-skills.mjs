// Vendors the pinned upstream skills into teacher/vendor-skills.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const vendorRoot = path.join(root, 'teacher', 'vendor-skills');

const sources = [
  {
    id: 'education-agent-skills',
    repo: 'https://github.com/GarethManning/education-agent-skills.git',
    license: 'CC BY-SA 4.0',
    copy: [
      'skills/curriculum-assessment/backwards-design-unit-planner',
      'skills/explicit-instruction/explicit-instruction-sequence-builder',
      'skills/explicit-instruction/checking-for-understanding-protocol-designer',
      'skills/questioning-discussion/hinge-question-designer',
      'skills/memory-learning-science/retrieval-practice-generator',
      'skills/curriculum-assessment/criterion-referenced-rubric-generator',
      'skills/inclusive-design/udl-lesson-auditor'
    ]
  },
  {
    id: 'pptkit-presentation',
    repo: 'https://github.com/openHacking/pptkit-presentation.git',
    license: 'MIT',
    copy: ['skills/pptkit-presentation']
  },
  {
    id: 'vercel-web-design',
    repo: 'https://github.com/vercel-labs/agent-skills.git',
    license: 'MIT',
    copy: ['skills/web-design-guidelines']
  }
];

function git(args, cwd) {
  return execFileSync('git', ['-c', 'http.proxy=', '-c', 'https.proxy=', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

for (const src of sources) {
  const dest = path.join(vendorRoot, src.id);
  const sourceFile = path.join(dest, 'SOURCE.json');
  console.log(`\n=== vendoring ${src.id} ===`);
  if (fs.existsSync(sourceFile)) {
    const meta = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
    console.log(`already vendored at ${meta.commit}`);
    continue;
  }
  fs.mkdirSync(vendorRoot, { recursive: true });
  git(['clone', '--depth', '1', src.repo, dest], vendorRoot);
  const head = git(['rev-parse', 'HEAD'], dest);
  for (const rel of src.copy) {
    const from = path.join(dest, rel);
    if (!fs.existsSync(from)) console.warn(`WARN missing ${rel} in ${src.id}`);
    else console.log(`OK ${src.id}/${rel}`);
  }
  fs.writeFileSync(sourceFile, JSON.stringify({ id: src.id, repo: src.repo, license: src.license, commit: head, copied: src.copy }, null, 2) + '\n');
  console.log(`Wrote ${sourceFile}`);
}