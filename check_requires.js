const fs = require('fs');
const path = require('path');
const cp = require('child_process');

function check(file, seen) {
  if (seen.has(file)) return [];
  seen.add(file);
  if (!fs.existsSync(file)) return [file];
  const c = fs.readFileSync(file, 'utf8');
  const missing = [];
  const reqs = [...c.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)].map(m => m[1]);
  for (const r of reqs) {
    let resolved = path.resolve(path.dirname(file), r);
    if (!resolved.endsWith('.js')) resolved += '.js';
    const rel = path.relative('.', resolved).replace(/\\/g, '/');
    try {
      cp.execSync('git ls-files --error-unmatch "' + rel + '"', { stdio: 'pipe' });
    } catch (e) {
      missing.push(rel);
    }
    missing.push(...check(resolved, seen));
  }
  return missing;
}

const seen = new Set();
const all = new Set();
check('backend/src/index.js', seen).forEach(f => all.add(f));
if (all.size === 0) {
  console.log('ALL OK');
} else {
  all.forEach(f => console.log('FALTA:', f));
}
