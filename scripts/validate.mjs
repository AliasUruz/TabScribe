import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { openSync, closeSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeXml } from '../src/shared/xml-export.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const outputLimit = 16000;

// Direct Node processes only: no shell, browser, install or persistent service.
export function classifyStep({ timedOut, spawnError, code, output }) {
  if (!timedOut && !spawnError && code === 0) return 'passed';
  if (!timedOut && !/AssertionError|ERR_ASSERTION/.test(output) && /connect EACCES (?:127\.0\.0\.1|::1):/.test(output)) return 'blocked';
  return 'failed';
}

export function runStep(name, args, { timeoutMs = 45000, cwd = root } = {}) {
  return new Promise(resolve => {
    const started = Date.now();
    let output = '';
    let timedOut = false;
    let spawnError;
    const child = spawn(process.execPath, args, {
      cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
    });
    const capture = chunk => { output = (output + chunk.toString()).slice(-outputLimit); };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32' && child.pid) {
        // Target this process tree only, including the temporary MCP child.
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true, stdio: 'ignore', shell: false,
        });
        killer.on('error', () => child.kill());
        killer.on('exit', code => { if (code) child.kill(); });
      } else child.kill('SIGKILL');
    }, timeoutMs);
    child.on('error', error => { spawnError = error.message; });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ name, status: classifyStep({ timedOut, spawnError, code, output }),
        durationMs: Date.now() - started, timedOut, exitCode: code,
        detail: spawnError ?? output.trim() });
    });
  });
}

export const pendingChecks = [
  ['edge', 'Interface, ícones, extração e seletores nos sites reais não foram exercitados.'],
  ['native_mcp', 'Descoberta nativa no ChatGPT e conexão com o Edge real não foram comprovadas.'],
  ['github', 'Publicação e commit remoto não foram consultados nem alterados.'],
];

export function renderReport(steps) {
  const failed = steps.some(step => step.status === 'failed');
  const blocked = steps.some(step => step.status === 'blocked');
  return `<?xml version="1.0" encoding="UTF-8"?>
<tabscribe_validation generated_at="${new Date().toISOString()}" automated_status="${failed ? 'failed' : blocked ? 'blocked' : 'passed'}" overall_status="${failed ? 'failed' : blocked ? 'blocked' : 'pending_live_validation'}">
  <scope>Verificação local; navegador simulado; MCP real em porta temporária. Sem abas, pesquisas, downloads do navegador ou alterações no GitHub.</scope>
  <checks>
${steps.map(step => `    <check name="${escapeXml(step.name)}" status="${step.status}" duration_ms="${step.durationMs}" timed_out="${Boolean(step.timedOut)}">
      <detail>${escapeXml(step.detail)}</detail>
    </check>`).join('\n')}
  </checks>
  <pending>
${pendingChecks.map(([name, detail]) => `    <check name="${name}" status="pending">${escapeXml(detail)}</check>`).join('\n')}
  </pending>
</tabscribe_validation>
`;
}

function acquireLock() {
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 16);
  const lock = path.join(tmpdir(), `tabscribe-validation-${hash}.lock`);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lock, 'wx');
      try { writeFileSync(fd, String(process.pid)); } finally { closeSync(fd); }
      return () => { unlinkSync(lock); };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(readFileSync(lock, 'utf8'));
      if (!Number.isInteger(pid) || pid <= 0) throw new Error('Validação já iniciando; tente novamente em instantes.');
      try { process.kill(pid, 0); }
      catch (probeError) {
        if (probeError.code !== 'ESRCH') throw probeError;
        unlinkSync(lock);
        continue;
      }
      throw new Error('Já existe uma validação em andamento para este projeto.');
    }
  }
  throw new Error('Não foi possível reservar a execução da validação.');
}

async function main() {
  if (process.argv.length > 2) throw new Error('Uso: npm run validate (sem argumentos).');
  const release = acquireLock();
  try {
    const unitTests = readdirSync(path.join(root, 'tests/unit'))
      .filter(name => name.endsWith('.test.mjs')).sort().map(name => `tests/unit/${name}`);
    const definitions = [
      ['structure', ['scripts/check-project.mjs']],
      ['unit', ['--test', '--test-reporter=tap', '--test-concurrency=1', ...unitTests]],
      ['search_simulated', ['--experimental-vm-modules', '--test', '--test-reporter=tap', '--test-concurrency=1', 'tests/integration/search-simulation.mjs']],
      ['mcp', ['tests/integration/mcp-smoke.js']],
      ['mcp_legacy', ['tests/integration/mcp-smoke.js', '--legacy']],
    ];
    const steps = [];
    for (const [name, args] of definitions) steps.push(await runStep(name, args));
    const directory = path.join(root, 'logs/validation');
    mkdirSync(directory, { recursive: true });
    const reportPath = path.join(directory, 'latest.txt');
    writeFileSync(reportPath, renderReport(steps), 'utf8');
    const failures = steps.filter(step => step.status === 'failed').length;
    const blocked = steps.filter(step => step.status === 'blocked').length;
    console.log(`TabScribe: ${steps.length - failures - blocked}/${steps.length} etapas aprovadas; ${failures} falhas; ${blocked} bloqueadas; 3 verificações reais pendentes.`);
    console.log(`Relatório XML: ${reportPath}`);
    process.exitCode = failures ? 1 : blocked ? 2 : 0;
  } finally { release(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`Validação: ${error.message}`); process.exitCode = 1; });
}