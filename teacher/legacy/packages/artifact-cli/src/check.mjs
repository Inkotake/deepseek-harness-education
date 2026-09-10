import fs from 'node:fs';
import path from 'node:path';
import { findProjectRoot, log, warn } from './common.mjs';

const SENSITIVE_PATTERNS = [
  /^\.env(\..*)?$/,
  /\.key$/,
  /\.pem$/,
  /^credentials\.json$/,
  /^id_rsa$/,
  /student.*\.(csv|xlsx|xls)$/i,
  /grades.*\.(csv|xlsx|xls)$/i
];

export async function checkArtifact(args = []) {
  const root = findProjectRoot();
  if (!root) throw new Error('Not inside a teacher-artifact project.');
  const dist = path.join(root, 'dist');
  const errors = [];
  const warnings = [];
  let fileCount = 0;

  if (!fs.existsSync(dist)) {
    errors.push({ code: 'DIST_MISSING', message: 'dist/ directory does not exist. Run teacher-artifact build first.' });
  } else {
    const indexPath = path.join(dist, 'index.html');
    if (!fs.existsSync(indexPath)) {
      errors.push({ code: 'INDEX_MISSING', message: 'dist/index.html not found.' });
    }

    const files = walk(dist);
    fileCount = files.length;
    const TEXT_EXT = new Set(['.html', '.htm', '.js', '.mjs', '.css', '.json', '.map', '.svg', '.txt', '.md']);
    const textFiles = files.filter((f) => TEXT_EXT.has(path.extname(f).toLowerCase()));
    const html = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : '';
    const allText = textFiles
      .map((f) => {
        try { return fs.readFileSync(f, 'utf8'); } catch { return ''; }
      })
      .join('\n');

    // 1. external CDN dependencies
    const cdn = allText.match(/(https?:\/\/)?(cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|cdn\.tailwindcss\.com|code\.jquery\.com|cdn\.bootcss\.com)/g);
    if (cdn) errors.push({ code: 'STATIC_DEPENDENCY_EXTERNAL', message: 'Found external CDN references: ' + [...new Set(cdn)].join(', ') });

    // 2. localhost urls
    const localhost = allText.match(/https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/g);
    if (localhost) errors.push({ code: 'LOCALHOST_URL', message: 'Found localhost URL in build output: ' + [...new Set(localhost)].join(', ') });

    // 3. absolute local paths (boundary check avoids minified-JS false positives like http:\\/\\/)
    if (/file:\/\//.test(allText)) errors.push({ code: 'FILE_PROTOCOL', message: 'Found file:// references; must be served over http.' });
    if (/(^|[^A-Za-z0-9])\/Users\/|\/home\//.test(allText)) errors.push({ code: 'LOCAL_FILE_ABSOLUTE_PATH', message: 'Found POSIX absolute local path reference.' });
    const winDriveRe = /(^|[^A-Za-z0-9])([A-Za-z]:[\\/])(?=[\\p{L}\\p{N}_.$])/gu;
    let winMatch;
    const winDrives = [];
    while ((winMatch = winDriveRe.exec(allText))) {
      winDrives.push(winMatch[2]);
    }
    if (winDrives.length) errors.push({ code: 'LOCAL_FILE_ABSOLUTE_PATH', message: 'Found Windows absolute local path reference: ' + [...new Set(winDrives)].join(', ') });

    // 5. sensitive files inside dist
    for (const f of files) {
      const base = path.basename(f);
      if (SENSITIVE_PATTERNS.some((re) => re.test(base))) {
        errors.push({ code: 'SENSITIVE_FILE', message: `Sensitive file in dist: ${path.relative(dist, f)}` });
      }
      // 6. overly large assets
      try {
        const size = fs.statSync(f).size;
        if (size > 50 * 1024 * 1024) {
          warnings.push({ code: 'ASSET_TOO_LARGE', message: `${path.relative(dist, f)} is ${(size / 1024 / 1024).toFixed(1)} MB (>50 MB)` });
        }
      } catch {}
    }

    // 7. index.html must not reference src/ or node_modules/
    if (/src\/main\.js|node_modules\//.test(html)) {
      errors.push({ code: 'DEV_SOURCE_REFERENCE', message: 'index.html references dev source (src/main.js or node_modules). Build output must be self-contained.' });
    }

    // 8. should be relative asset paths
    if (/src="\//.test(html) || /href="\//.test(html)) {
      warnings.push({ code: 'ROOT_ABSOLUTE_PATH', message: 'index.html uses root-absolute paths (/assets/...). Use --base ./ to keep it portable.' });
    }
  }

  log('teacher-artifact check');
  log('  dist: ' + (fs.existsSync(dist) ? dist : 'MISSING'));
  log('  files: ' + fileCount);
  for (const w of warnings) { warn(`[${w.code}] ${w.message}`); }
  for (const e of errors) { log(`  FAIL [${e.code}] ${e.message}`); }

  if (errors.length === 0) {
    log('  PASS - artifact is self-contained and safe to publish.');
    return 0;
  }
  log(`${errors.length} error(s), ${warnings.length} warning(s).`);
  return 1;
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}