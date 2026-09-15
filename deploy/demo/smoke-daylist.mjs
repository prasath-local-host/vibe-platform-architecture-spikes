import assert from 'node:assert/strict';
const base = process.env.SMOKE_BASE_URL;
const revision = process.env.EXPECTED_REVISION;
assert.ok(base && /^[0-9a-f]{40}$/.test(revision ?? ''), 'Base URL and exact revision required');
const timeout = () => AbortSignal.timeout(10000);
let ready = false;
for (let attempt = 0; attempt < 30; attempt++) {
  try { if ((await fetch(`${base}/api/health`, { signal: timeout() })).ok) { ready = true; break; } } catch {}
  await new Promise(resolve => setTimeout(resolve, 1000));
}
assert.ok(ready, 'Application starts and responds');
const health = await (await fetch(`${base}/api/health`, { signal: timeout() })).json();
assert.equal(health.revision, revision, 'Exact deployed revision');
const readiness = await fetch(`${base}/api/ready`, { signal: timeout() });
assert.equal(readiness.status, 200);
assert.equal((await readiness.json()).status, 'ready');
const page = await fetch(base, { signal: timeout() });
assert.equal(page.status, 200, 'Task workspace renders');
const html = await page.text();
assert.match(html, /Daylist/);
assert.match(html, /New task/);
assert.doesNotMatch(html, /aksello/i);
console.log('Daylist startup, exact revision, readiness, workspace and neutral branding passed');
