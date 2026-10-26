import test from 'node:test';
import assert from 'node:assert/strict';
import { runStep, renderReport, classifyStep } from '../../scripts/validate.mjs';

test('validator captures failure, bounds output and continues subsequent checks', async () => {
  const failed = await runStep('failure', ['-e', 'process.stdout.write("x".repeat(40000)); process.exitCode = 2;']);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.exitCode, 2);
  assert.ok(failed.detail.length <= 16000);
  const passed = await runStep('success', ['-e', 'console.log("ok")']);
  assert.equal(passed.status, 'passed');
});

test('validator terminates a hung process', async () => {
  const step = await runStep('hung', ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 250 });
  assert.equal(step.status, 'failed');
  assert.equal(step.timedOut, true);
});

test('report escapes logs and preserves pending live verification after success', () => {
  const xml = renderReport([{ name: 'test', status: 'passed', durationMs: 1, detail: '<page>&"' }]);
  assert.ok(xml.includes('overall_status="pending_live_validation"'));
  assert.ok(xml.includes('&lt;page&gt;&amp;&quot;'));
  assert.equal((xml.match(/status="pending"/g) ?? []).length, 3);
  assert.ok(renderReport([{ name: 'failure', status: 'failed', durationMs: 1 }]).includes('overall_status="failed"'));
});
test('network permission blocks remain distinct from code failures and success', () => {
  assert.equal(classifyStep({ code: 1, output: 'Error: connect EACCES 127.0.0.1:3031' }), 'blocked');
  assert.equal(classifyStep({ code: 1, output: 'AssertionError' }), 'failed');
  assert.equal(classifyStep({ code: 1, output: 'AssertionError; connect EACCES 127.0.0.1:3031' }), 'failed');
  assert.equal(classifyStep({ code: 0, output: '' }), 'passed');
  assert.ok(renderReport([{ name: 'mcp', status: 'blocked', durationMs: 1 }]).includes('automated_status="blocked"'));
});
