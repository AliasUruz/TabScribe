export function escapeXml(value) {
  return String(value ?? '')
    .replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}
const element = (name, value) => `<${name}>${escapeXml(value)}</${name}>`;
const fields = (value, names) => names.filter(name => value[name] !== undefined)
  .map(name => element(name, value[name])).join('\n');
const citationsXml = citations => `<citations>${(citations ?? []).map(citation =>
  `<citation>${fields(citation, ['label', 'url'])}</citation>`).join('\n')}</citations>`;

export function compileSearchXml(results, aiOverviews = [], metadata = {}) {
  const queries = results.map((result, index) => {
    const overview = aiOverviews.find(item => item.queryIndex === index || (item.queryIndex === undefined && item.query === result.query));
    const ai = overview ? `<ai_response status="${escapeXml(overview.isTimeout ? 'partial' : overview.error ? 'error' : 'complete')}">
${fields(overview, ['engine', 'content', 'strategy', 'error'])}
${citationsXml(overview.citations)}
</ai_response>` : '<ai_response status="unavailable"/>';
    const sources = (result.links ?? []).map(link => `<source>
${fields(link, ['title', 'url', 'content', 'extractionMode', 'error', 'publicationDate', 'language'])}
</source>`).join('\n');
    return `<query index="${index + 1}">
${element('text', result.query)}
${result.error ? element('error', result.error) : ''}
${ai}
<sources>${sources}</sources>
</query>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<tabscribe_report version="1" kind="search" job_id="${escapeXml(metadata.jobId)}" generated_at="${escapeXml(metadata.generatedAt ?? new Date().toISOString())}">
${metadata.instructions ? element('instructions', metadata.instructions) : ''}
<queries>${queries}</queries>
</tabscribe_report>`;
}

export function compileTabsXml(tabs) {
  const valid = tabs.filter(item => item.content && item.content.trim().length > 0);
  if (valid.length === 0) return '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<tabscribe_report version="1" kind="tabs" generated_at="${new Date().toISOString()}">
<tabs>${valid.map(tab => `<tab id="${escapeXml(tab.id)}">
${fields(tab, ['title', 'url', 'language', 'contentType', 'publicationDate', 'content', 'extractionMode'])}
</tab>`).join('\n')}</tabs>
</tabscribe_report>`;
}
