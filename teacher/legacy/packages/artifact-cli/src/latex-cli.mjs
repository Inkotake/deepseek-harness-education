import fs from 'node:fs';
import path from 'node:path';
import { error, log, warn } from './common.mjs';

const [, , command, ...args] = process.argv;

async function main() {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    log('teacher-latex - LaTeX interface for Teacher DSH 0.1');
    log('');
    log('Usage:');
    log('  teacher-latex build <file.tex>     Validate a .tex document (PDF engine reserved)');
    log('  teacher-latex info                 Show bundled LaTeX capability status');
    process.exit(0);
  }

  if (command === 'info') {
    log('KaTeX: bundled (HTML/PPT formula rendering)');
    log('TeX -> PDF engine: NOT bundled in MVP 0.1 (interface reserved, see versions.lock.json note)');
    process.exit(0);
  }

  if (command === 'build') {
    const file = args[0];
    if (!file) throw new Error('Usage: teacher-latex build <file.tex>');
    const full = path.resolve(process.cwd(), file);
    if (!fs.existsSync(full)) throw new Error(`File not found: ${full}`);
    const text = fs.readFileSync(full, 'utf8');
    const hasClass = /\\documentclass/.test(text);
    const hasBegin = /\\begin\{document\}/.test(text);
    const hasEnd = /\\end\{document\}/.test(text);
    log(`Validating ${full}`);
    if (!hasClass) warn('Missing \\documentclass');
    if (!hasBegin) warn('Missing \\begin{document}');
    if (!hasEnd) warn('Missing \\end{document}');
    if (hasClass && hasBegin && hasEnd) {
      log('VALID_TEX - document structure OK.');
    } else {
      error('INVALID_TEX - fix the issues above before future PDF build.');
      process.exit(1);
    }
    log('PDF build is reserved for the future Tectonic Pack (not bundled in 0.1).');
    log('Use KaTeX HTML rendering for formula preview in this version.');
    process.exit(0);
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((err) => {
  error(err.message);
  process.exit(1);
});