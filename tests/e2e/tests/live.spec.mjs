import { randomUUID } from 'node:crypto';
import { test, expect, recordEvidence } from '../support/fixtures.mjs';

test('A15 two private live subscribers, scoped hints, reconnect and expiring credentials', async ({ ownerApi, ownerPage, browser, baseURL }) => {
  test.setTimeout(135_000);
  const project = await ownerApi.createProject({ name: 'Live Board' });
  const other = await ownerApi.createProject({ name: 'Privates zweites Board' });
  await ownerApi.ensureDefaultBoard(project.id);
  const topic = (id) => 'urn:falkenwarte:project:' + id;
  const initial = await ownerApi.createTask(project.id, { title: 'Live vor der Änderung' });
  const mutation = async (id, title) => {
    const current = await ownerApi.get('/tasks/' + id);
    const updated = await ownerApi.patch('/tasks/' + id, { title }, { version: current.data.version });
    expect(updated.response.status()).toBe(200);
    return updated.data;
  };

  await ownerPage.goto('/#/project/' + project.id + '/board');
  await expect(ownerPage.getByText(initial.title ?? 'Live vor der Änderung', { exact: true })).toBeVisible();
  await expect(ownerPage.getByRole('status').filter({ hasText: /^Live$/ })).toBeVisible();

  // This independent owner session requests a narrower grant. Its EventSource
  // deliberately matches both topics so the check exercises the hub's authorization.
  const restricted = await browser.newContext({ baseURL });
  try {
    const login = await restricted.request.post('/api/v1/session', {
      data: { password: process.env.FALKENWARTE_QA_OWNER_PASSWORD ?? 'Falkenwarte-Test-Owner-Password-2026!' },
    });
    expect(login.status()).toBe(200);
    const { csrf_token: csrf } = await login.json();
    const authorized = await restricted.request.post('/api/v1/live/authorize', {
      headers: { 'X-CSRF-Token': csrf, 'Idempotency-Key': randomUUID() }, data: { project_ids: [project.id] },
    });
    expect(authorized.status()).toBe(200);
    const grant = await authorized.json();
    expect(Object.keys(grant).sort()).toEqual(['authorized', 'expires_at', 'topics']);
    expect(grant.topics).toEqual([topic(project.id)]);
    const config = await restricted.request.get('/api/v1/live/config');
    const { public_url: hub, ttl } = await config.json();
    expect(new URL(hub).origin).toBe(new URL(baseURL).origin);
    const limitedCookie = (await restricted.cookies(hub)).find((c) => c.name === '__Secure-mercure_access_token');
    expect(Boolean(limitedCookie?.httpOnly && limitedCookie.secure && limitedCookie.sameSite === 'Strict')).toBe(true);
    expect(limitedCookie.path).toBe('/.well-known/mercure');

    const subscriber = await restricted.newPage();
    await subscriber.goto('/docs/');
    await subscriber.evaluate(({ hub, topics }) => {
      const url = new URL(hub);
      topics.forEach((t) => url.searchParams.append('match', t));
      window.receivedHints = [];
      window.limitedStream = new EventSource(url, { withCredentials: true });
      window.limitedStream.onmessage = ({ data }) => window.receivedHints.push(JSON.parse(data));
    }, { hub, topics: [topic(project.id), topic(other.id)] });
    await expect.poll(() => subscriber.evaluate(() => window.limitedStream.readyState)).toBe(1);
    const deniedPublish = await restricted.request.post(hub, {
      headers: { Origin: new URL(baseURL).origin }, form: { topic: topic(project.id), data: '{}', private: 'on' },
    });
    expect([401, 403]).toContain(deniedPublish.status());
    await ownerApi.createTask(other.id, { title: 'Diese Änderung bleibt im anderen Projekt' });
    const liveTitle = 'Privat zugestellte Browseränderung';
    const changed = await mutation(initial.id, liveTitle);
    await expect(ownerPage.getByText(liveTitle, { exact: true })).toBeVisible();
    await expect.poll(() => subscriber.evaluate(({ id, version }) => window.receivedHints.some((e) => e.resource_id === id && e.version === version), changed)).toBe(true);
    expect(await subscriber.evaluate((forbidden) => window.receivedHints.some((e) => e.project_id === forbidden), other.id)).toBe(false);
    expect(await subscriber.evaluate(() => document.cookie.includes('mercure_access_token'))).toBe(false);
    // A new cookie must be issued by the application's own renewal timer.
    const cookieValue = async () => (await ownerPage.context().cookies(hub)).find((c) => c.name === '__Secure-mercure_access_token')?.value;
    const beforeRenewal = await cookieValue();
    expect(Boolean(beforeRenewal)).toBe(true);
    await expect.poll(async () => {
      const next = await cookieValue();
      return Boolean(next && next !== beforeRenewal);
    }, { timeout: ttl * 1000 + 5000, intervals: [500, 1000] }).toBe(true);
    // The limited client deliberately never renews. After expiry its previous
    // bearer credential itself must fail, independently of browser cookie expiry.
    await expect.poll(() => Date.now() > Date.parse(grant.expires_at) + 1000, { timeout: ttl * 1000 + 3000 }).toBe(true);
    const expired = await restricted.request.get(hub + '?match=' + encodeURIComponent(topic(project.id)), {
      headers: { Authorization: 'Bearer ' + limitedCookie.value }, timeout: 5000,
    });
    expect([401, 403]).toContain(expired.status());

    // Interrupt the rendered board's network while a different client writes.
    const renewal = ownerPage.waitForResponse((r) => r.url().endsWith('/live/authorize') && r.status() === 200);
    await ownerPage.context().setOffline(true);
    const offlineTitle = 'Während der Unterbrechung aktualisiert';
    await mutation(initial.id, offlineTitle);
    await ownerPage.context().setOffline(false);
    await renewal;
    await expect(ownerPage.getByText(offlineTitle, { exact: true })).toBeVisible();
    await expect(ownerPage.getByRole('status').filter({ hasText: /^Live$/ })).toBeVisible();
    const logout = await restricted.request.delete('/api/v1/session', { headers: { 'X-CSRF-Token': csrf } });
    expect(logout.ok()).toBe(true);
    expect((await restricted.cookies(hub)).some((c) => c.name === '__Secure-mercure_access_token')).toBe(false);
    recordEvidence('Private Projektupdates, Entzug bei Ablauf und erneuter Datenabruf im Browser funktionieren über den eingebetteten Hub.', 'Zwei unabhängige Sitzungen empfingen private Updates. Der eingeschränkte Subscriber sah nur sein Projekt und konnte nicht publizieren. Ein abgelaufener Grant wurde abgelehnt. Das Browserboard erneuerte sein Cookie und zeigte nach Wiederverbindung die zwischenzeitliche Ticketänderung.');
  } finally {
    await restricted.close();
  }
});
