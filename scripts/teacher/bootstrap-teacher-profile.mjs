// Creates the teacher profile bootstrap manifest consumed by the Desktop integration.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = {
  name: 'teacher',
  default: true,
  bundles: [
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-web-app',
    '@teacher-dsh/teacher-bundle'
  ],
  plugins: [
    'dsh-better-sidebar',
    'dsh-cowork',
    'pptkit-presentation'
  ],
  bundledSkills: [
    'teacher/packages/teacher-bundle/resources/teacher-skills',
    'teacher/vendor-skills/education-agent-skills',
    'teacher/vendor-skills/pptkit-presentation/skills/pptkit-presentation',
    'teacher/vendor-skills/vercel-web-design/skills/web-design-guidelines'
  ],
  permissionPreset: 'workspace-write'
};
const out = path.join(root, 'teacher', 'manifests', 'teacher-profile.lock.json');
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
console.log('Wrote', out);