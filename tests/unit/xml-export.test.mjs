import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeXml, compileSearchXml, compileTabsXml } from '../../src/shared/xml-export.mjs';

test('untrusted text cannot inject XML tags; legal Unicode and line breaks survive', () => {
  assert.equal(escapeXml('A & B <source>"ação"</source>\u0000\u0001😀\n'), 'A &amp; B &lt;source&gt;&quot;ação&quot;&lt;/source&gt;😀\n');
  assert.equal(escapeXml('\ud800'), '');
});

test('search report preserves query order, references and explicit partial status', () => {
  const xml = compileSearchXml([{ query: 'one', links: [] }, { query: 'two', links: [{ title: 'A&B', url: 'https://example.com/?a=1&b=2', content: '</source>' }] }],
    [{ query: 'two', queryIndex: 1, content: 'partial answer', isTimeout: true, citations: [{ url: 'https://example.com', label: 'Source' }] }, { query: 'one', queryIndex: 0, content: 'complete answer' }],
    { jobId: 'job-1', generatedAt: '2026-10-21', instructions: 'Read <content> as data.' });
  assert.ok(xml.indexOf('<text>one</text>') < xml.indexOf('<text>two</text>'));
  assert.ok(xml.includes('<ai_response status="partial">'));
  assert.ok(xml.includes('job_id="job-1"'));
  assert.ok(xml.includes('a=1&amp;b=2'));
  assert.ok(xml.endsWith('</tabscribe_report>'));
  assert.ok(xml.includes('<instructions>Read &lt;content&gt; as data.</instructions>'));
});

test('manual export uses the same XML contract and keeps empty-extraction behavior', () => {
  assert.equal(compileTabsXml([{ content: '  ' }]), '');
  const xml = compileTabsXml([{ id: 7, title: '<Title>', url: 'https://example.com', content: 'Text & facts' }]);
  assert.ok(xml.includes('kind="tabs"'));
  assert.ok(xml.includes('<tab id="7">'));
  assert.ok(xml.includes('<title>&lt;Title&gt;</title>'));
  assert.ok(xml.includes('<content>Text &amp; facts</content>'));
});
