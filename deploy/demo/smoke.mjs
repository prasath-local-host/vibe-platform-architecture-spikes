import assert from 'node:assert/strict';

const base = process.env.SMOKE_BASE_URL;
if (!base) throw new Error('SMOKE_BASE_URL is required');
const timeout = () => AbortSignal.timeout(10000);
let ready = false;
for (let attempt = 0; attempt < 30; attempt++) {
  try { if ((await fetch(`${base}/api/health`, { signal: timeout() })).ok) { ready = true; break; } } catch {}
  await new Promise(resolve => setTimeout(resolve, 1000));
}
assert.ok(ready, 'Application starts and responds');
const health = await (await fetch(`${base}/api/health`, { signal: timeout() })).json();
assert.equal(health.revision, process.env.EXPECTED_REVISION);
const login = await fetch(`${base}/login`, { signal: timeout() });
assert.equal(login.status, 200, 'Login page renders');
assert.match(await login.text(), /vcp-public-config/, 'Runtime public configuration is rendered');
const protectedPage = await fetch(`${base}/dashboard`, { redirect: 'manual', signal: timeout() });
assert.ok([302, 303, 307, 308].includes(protectedPage.status), 'Anonymous access redirects');
assert.equal(new URL(protectedPage.headers.get('location'), base).pathname, '/login');
const ai = await fetch(`${base}/api/ai`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"steg1"}', signal: timeout() });
assert.equal(ai.status, 401, 'Anonymous AI requests are denied');
console.log('Startup, revision, login, protected-page and AI authorization smoke checks passed');
