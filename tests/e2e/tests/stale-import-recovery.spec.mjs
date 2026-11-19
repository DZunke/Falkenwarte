import { test, expect, recordEvidence } from '../support/fixtures.mjs';

test('a stale dashboard chunk can be recovered by reloading the current app bundle', async ({ ownerPage }) => {
  const dashboardChunk = '**/build/assets/dashboard-*.js';
  await ownerPage.route(dashboardChunk, (route) => route.abort());
  await ownerPage.goto('/#/dashboard');

  await expect(ownerPage.getByRole('heading', { name: 'Diese Ansicht konnte nicht geladen werden' })).toBeVisible();
  await expect(ownerPage.getByRole('button', { name: 'Erneut versuchen' })).toBeVisible();

  await ownerPage.unroute(dashboardChunk);
  const navigation = ownerPage.waitForEvent('framenavigated', (frame) => frame === ownerPage.mainFrame());
  await ownerPage.getByRole('button', { name: 'Erneut versuchen' }).click();
  await navigation;
  await expect(ownerPage.locator('#main-content').getByRole('heading', { name: 'Übersicht' })).toBeVisible();

  recordEvidence(
    'Ein abgelaufenes dynamisches App-Modul zeigt einen verständlichen Wiederherstellungsweg und lässt sich nach erneutem Laden mit dem aktuellen Bundle öffnen.',
    'Der Browser lud das Dashboard-Modul zunächst absichtlich nicht. Die App zeigte „Diese Ansicht konnte nicht geladen werden“ und „Erneut versuchen“. Nach Entfernen der Netzwerkstörung lud die Schaltfläche die aktuelle App-Datei; das Dashboard wurde anschließend sichtbar.',
  );
});
