import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

// Check the files and references that the browser and MCP host actually load.
// This command does not start the bridge, open tabs, or execute extension code.
const root = fileURLToPath(new URL('../', import.meta.url));
const errors = [];
const counts = { syntax: 0, references: 0, links: 0 };

function projectFile(reference, base = root, allowDirectory = false) {
  const resolved = path.resolve(base, reference);
  const relative = path.relative(root, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    errors.push(`Reference outside project: ${reference}`);
    return;
  }
  try {
    const entry = statSync(resolved);
    if (!entry.isFile() && !(allowDirectory && entry.isDirectory())) throw new Error('not a file');
    counts.references++;
  } catch {
    errors.push(`Missing file: ${relative}`);
  }
}

function localUrl(reference, base) {
  if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(reference)) return;
  projectFile(reference.split(/[?#]/, 1)[0], base);
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3 || manifest.background?.type !== 'module') {
  errors.push('Expected Manifest V3 with a module service worker.');
}
projectFile(manifest.background.service_worker);
projectFile(manifest.action.default_popup);
for (const icons of [manifest.icons, manifest.action.default_icon]) {
  for (const [size, icon] of Object.entries(icons ?? {})) {
    projectFile(icon);
    try {
      const data = readFileSync(path.join(root, icon));
      const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      if (data.length < 33 || !data.subarray(0, 8).equals(signature)
        || data.toString('ascii', 12, 16) !== 'IHDR') {
        errors.push(`Expected a real PNG icon: ${icon}`);
      } else if (data.readUInt32BE(16) !== Number(size) || data.readUInt32BE(20) !== Number(size)) {
        errors.push(`Expected ${size}x${size} icon: ${icon}`);
      }
    } catch (error) {
      errors.push(`Cannot validate icon ${icon}: ${error.message}`);
    }
  }
}
for (const group of manifest.web_accessible_resources ?? []) {
  for (const resource of group.resources) projectFile(resource);
}
for (const group of manifest.content_scripts ?? []) {
  for (const resource of [...(group.js ?? []), ...(group.css ?? [])]) projectFile(resource);
}

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
projectFile(pkg.main);
const dependencies = value => JSON.stringify(Object.entries(value ?? {}).sort());
if (dependencies(pkg.dependencies) !== dependencies(lock.packages[''].dependencies)) {
  errors.push('package.json dependencies differ from package-lock.json.');
}

const sourceFiles = ['src', 'server', 'tests', 'scripts', 'vendor']
  .flatMap(directory => walk(path.join(root, directory)));
sourceFiles.push(path.join(root, 'tabscribe-mcp.js'));

for (const fullPath of sourceFiles) {
  const relative = path.relative(root, fullPath).replaceAll(path.sep, '/');
  const extension = path.extname(fullPath);
  if (!['.js', '.mjs', '.html', '.css'].includes(extension)) continue;
  const source = readFileSync(fullPath, 'utf8');
  const base = path.dirname(fullPath);

  if (extension === '.js' || extension === '.mjs') {
    const classic = relative.startsWith('src/content/');
    const module = extension === '.mjs' || (relative.startsWith('src/') && !classic);
    const result = spawnSync(process.execPath, [
      '--check', `--input-type=${module ? 'module' : 'commonjs'}`,
    ], { input: source, encoding: 'utf8', windowsHide: true });
    if (result.error || result.status !== 0) {
      errors.push(`Syntax error in ${relative}: ${result.error?.message ?? result.stderr}`);
    }
    counts.syntax++;

    // Browser module imports resolve relative to the importing file.
    if (relative.startsWith('src/') || extension === '.mjs') {
      for (const match of source.matchAll(/\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
        projectFile(match[1], base);
      }
    }
    // Node package resolution is checked without executing those packages.
    if (relative.startsWith('server/') || relative.startsWith('tests/') || relative === 'tabscribe-mcp.js') {
      const require = createRequire(fullPath);
      for (const match of source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        try { require.resolve(match[1]); }
        catch { errors.push(`Unresolved Node dependency in ${relative}: ${match[1]}`); }
      }
      for (const match of source.matchAll(/path\.resolve\(\s*__dirname\s*,\s*['"]([^'"]+)['"]/g)) {
        projectFile(match[1], base, true);
      }
    }
    // Injection paths and getURL() paths resolve from the extension root.
    if (relative.startsWith('src/')) {
      for (const match of source.matchAll(/chrome\.runtime\.getURL\(\s*['"]([^'"]+)['"]/g)) {
        projectFile(match[1]);
      }
      for (const array of source.matchAll(/\bfiles\s*:\s*\[([^\]]*)\]/g)) {
        for (const match of array[1].matchAll(/['"]([^'"]+)['"]/g)) projectFile(match[1]);
      }
    }
  } else if (extension === '.html') {
    for (const match of source.matchAll(/\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/g)) {
      localUrl(match[1], base);
    }
  } else {
    for (const match of source.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g)) {
      localUrl(match[1], base);
    }
  }
}

const documents = ['README.md', 'AGENTS.md', 'PLANS.md', 'docs/PROJECT.md', 'docs/AI_WORKFLOW.md'];
for (const document of documents) {
  const fullPath = path.join(root, document);
  const source = readFileSync(fullPath, 'utf8');
  for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    if (/^[a-z][a-z\d+.-]*:/i.test(match[1]) || match[1].startsWith('#')) continue;
    localUrl(match[1], path.dirname(fullPath));
    counts.links++;
  }
}

if (errors.length) {
  for (const error of errors) console.error(`FAIL: ${error}`);
  process.exitCode = 1;
} else {
  console.log(`OK: ${counts.syntax} JavaScript syntax checks, ${counts.references} local references, ${counts.links} documentation links.`);
  console.log('Structural checks only; Edge behavior and live integrations need separate verification.');
}
