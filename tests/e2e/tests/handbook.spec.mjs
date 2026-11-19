import { test, expect, recordEvidence } from '../support/fixtures.mjs';

test('A23 A32 handbook links the implemented lifecycle, versioned events, release decision and acceptance evidence', async ({ ownerPage }) => {
  await ownerPage.goto('/docs/');
  const article = ownerPage.locator('article');
  await expect(article.getByRole('heading', { name: 'Falkenwarte-Dokumentation' })).toBeVisible();
  await article.locator('a[href$="/domain/LIFECYCLES.html"]').click();
  await expect(article.getByRole('heading', { name: 'Lebenszyklen und Übergänge' })).toBeVisible();
  await article.getByRole('link', { name: 'Ereigniskatalog' }).click();
  const envelope = await article.getByRole('link', { name: 'gemeinsamen Umschlag' }).getAttribute('href');
  const schema = await ownerPage.request.get(envelope);
  expect(schema.status()).toBe(200);
  expect((await schema.json()).$id).toMatch(/v1$/);
  await ownerPage.goto('/docs/DECISIONS.html');
  await article.getByRole('link', { name: 'ADR-0015' }).click();
  await expect(article.getByRole('heading', { name: /QA für den Release-Pull-Request/ })).toBeVisible();
  await article.getByRole('link', { name: 'Anforderungsmatrix' }).click();
  await expect(article.getByRole('cell', { name: 'R36', exact: true })).toBeVisible();
  await ownerPage.goto('/#/docs');
  await expect(ownerPage.locator('main').getByRole('heading', { name: 'Falkenwarte-Dokumentation' }).first()).toBeVisible();
  await ownerPage.locator('main').getByRole('link', { name: 'Benutzerhandbuch' }).click();
  await expect(ownerPage.locator('main').getByRole('heading', { name: /Ein Projekt anlegen/ })).toBeVisible();
  recordEvidence('Statisches Handbuch und lesbarer Bereich in der App verbinden Fachsprache, Ereignisse, ADRs und Abnahme.', 'Chromium folgte vom Index über Lifecycle und Ereignisse zum versionierten JSON-Schema. Die Releaseentscheidung führte zu R36 in der Abnahmematrix. Das Benutzerhandbuch ließ sich auch aus der React-Oberfläche öffnen.');
});
