import { text } from 'node:stream/consumers';
import { test, expect, recordEvidence } from '../support/fixtures.mjs';

test('A23 A32 handbook navigation, repository links and anchors work in the static and in-app readers', async ({ ownerPage }) => {
  const manifestResponse = await ownerPage.request.get('/docs/index.json');
  expect(manifestResponse.status()).toBe(200);
  const manifest = await manifestResponse.json();
  const documentPaths = manifest.documents.map((document) => document.path);
  expect(documentPaths).toContain('README.md');
  expect(documentPaths).toContain('API.md');
  expect(documentPaths).toContain('ARCHITECTURE.md');
  expect(documentPaths).toContain('adr/0001.md');
  expect(documentPaths).toContain('user/PROJECTS_AND_TICKETS.md');
  expect(documentPaths).toContain('operations/DEPLOYMENT_AND_CONFIGURATION.md');
  expect(documentPaths).not.toContain('PRODUCT_CONCEPT.md');
  expect(documentPaths).not.toContain('MOCKUPS.md');
  expect(documentPaths).not.toContain('ACCEPTANCE.md');
  expect(documentPaths).not.toContain('TRACEABILITY.md');
  expect(documentPaths).not.toContain('VALIDATION.md');
  expect(manifest.documents.every((document) => document.markdown === undefined)).toBe(true);

  await ownerPage.setViewportSize({ width: 390, height: 844 });
  await ownerPage.goto('/docs/');
  const staticArticle = ownerPage.locator('main article');
  await expect(staticArticle.locator('h1').first()).toBeVisible();
  const articleHeading = await staticArticle.locator('h1').first().boundingBox();
  expect(articleHeading?.y).toBeLessThan(844);
  const introduction = await staticArticle.locator('p').first().boundingBox();
  expect(introduction?.y).toBeLessThan(844);
  expect((introduction?.y ?? 0) + (introduction?.height ?? 0)).toBeLessThan(844);

  const staticNavigation = ownerPage.getByRole('navigation', { name: 'Handbuch' });
  const mobileContents = staticNavigation.locator('details.handbook-nav-mobile');
  await expect(mobileContents.locator('summary')).toBeVisible();
  expect(await mobileContents.evaluate((element) => element.open)).toBe(false);
  await mobileContents.locator('summary').click();
  await expect(staticNavigation.getByRole('heading', { name: 'Benutzerhandbuch' })).toBeVisible();
  await expect(staticNavigation.getByRole('heading', { name: 'Fachmodell' })).toBeVisible();

  const staticPageHrefs = await staticNavigation.locator('.handbook-nav-mobile a').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  expect(staticPageHrefs).toContain('/docs/API.html');
  expect(staticPageHrefs).toContain('/docs/adr/0001.html');
  expect(staticPageHrefs).toContain('/docs/user/PROJECTS_AND_TICKETS.html');
  expect(staticPageHrefs).toContain('/docs/operations/DEPLOYMENT_AND_CONFIGURATION.html');
  const pageResponses = await Promise.all(staticPageHrefs.map((href) => ownerPage.request.get(href)));
  expect(pageResponses.every((response) => response.status() === 200)).toBe(true);

  const retiredPages = ['PRODUCT_CONCEPT', 'MOCKUPS', 'SOURCES', 'CHANGELOG', 'ACCEPTANCE', 'TRACEABILITY', 'VALIDATION'];
  const retiredResponses = await Promise.all(retiredPages.map((name) => ownerPage.request.get(`/docs/${name}.html`)));
  expect(retiredResponses.map((response) => response.status())).toEqual(retiredPages.map(() => 404));

  await ownerPage.goto('/docs/DECISIONS.html');
  await staticArticle.getByRole('link', { name: 'ADR-0002', exact: true }).click();
  await expect(staticArticle.getByRole('heading', { name: /ADR-0002.*SQLite/, level: 1 })).toBeVisible();

  await ownerPage.goto('/docs/DOCUMENTATION.html');
  const sourceHref = await ownerPage.locator('main article').getByRole('link', { name: 'Build-Skript' }).getAttribute('href');
  expect(sourceHref).toBe(`https://github.com/DZunke/Falkenwarte/blob/${manifest.revision}/scripts/build-docs.php`);
  await ownerPage.goto('/docs/ARCHITECTURE.html');
  const sourceDirectoryHref = await ownerPage.locator('main article').getByRole('link', { name: 'Fachmodule im Quellbaum' }).getAttribute('href');
  expect(sourceDirectoryHref).toBe(`https://github.com/DZunke/Falkenwarte/tree/${manifest.revision}/src`);

  await ownerPage.goto('/docs/API.html');
  const schemaLink = ownerPage.locator('main article a[href^="/docs/contracts/schemas/"]').first();
  const schemaHref = await schemaLink.getAttribute('href');
  expect(schemaHref).toBeTruthy();
  const schemaResponse = await ownerPage.request.get(schemaHref);
  expect(schemaResponse.status()).toBe(200);
  expect((await schemaResponse.json()).$id).toMatch(/v[1-9][0-9]*$/);

  await ownerPage.goto('/docs/ARCHITECTURE.html');
  const intakeImage = ownerPage.locator('main article img[src$="/media/ticket-intake.svg"]');
  const imageHref = await intakeImage.getAttribute('src');
  expect(imageHref).toBe('/docs/content/media/ticket-intake.svg');
  expect((await ownerPage.request.get(imageHref)).status()).toBe(200);

  await ownerPage.goto('/docs/USER_GUIDE.html');
  const operationsLink = ownerPage.locator('main article a[href^="/docs/OPERATIONS.html#"]');
  await expect(operationsLink).toHaveCount(1);
  expect(decodeURIComponent(await operationsLink.getAttribute('href'))).toContain('#status-prüfen');
  await operationsLink.click();
  await expect(ownerPage).toHaveURL(/\/docs\/OPERATIONS\.html#status-pr%C3%BCfen$/);
  await expect(ownerPage.locator('#status-prüfen')).toBeVisible();

  await ownerPage.setViewportSize({ width: 390, height: 844 });
  await ownerPage.goto('/#/docs/README.md');
  const appMobileContents = ownerPage.locator('main details');
  await expect(appMobileContents.locator('summary')).toBeVisible();
  expect(await appMobileContents.evaluate((element) => element.open)).toBe(false);
  const appMobileHeading = ownerPage.locator('main article h1').first();
  await expect(appMobileHeading).toBeVisible();
  const appHeadingBox = await appMobileHeading.boundingBox();
  expect(appHeadingBox?.y).toBeLessThan(844);
  await appMobileContents.locator('summary').click();
  await expect(appMobileContents.getByRole('heading', { name: 'Fachmodell' })).toBeVisible();

  await ownerPage.setViewportSize({ width: 1440, height: 1000 });
  const appNavigation = ownerPage.getByRole('navigation', { name: 'Dokumente' });
  await expect(appNavigation.getByRole('heading', { name: 'Entwicklung' })).toBeVisible();
  await expect(appNavigation.getByRole('heading', { name: 'Fachmodell' })).toBeVisible();
  const apiDocument = manifest.documents.find((document) => document.path === 'API.md');
  await appNavigation.getByRole('button', { name: apiDocument.title, exact: true }).click();
  const appArticle = ownerPage.locator('main article');
  await expect(appArticle.getByRole('heading', { name: apiDocument.title, level: 1 })).toBeVisible();
  expect(await appArticle.locator('h1').count()).toBe(1);
  const contents = ownerPage.getByRole('navigation', { name: 'Auf dieser Seite' });
  const firstSection = contents.getByRole('link').first();
  await expect(firstSection).toBeVisible();
  const sectionId = decodeURIComponent(new URL(await firstSection.getAttribute('href'), 'https://falkenwarte.test').hash.slice(1));
  await firstSection.click();
  await expect(appArticle.locator(`[id="${sectionId}"]`)).toBeVisible();

  await ownerPage.goto('/#/docs/USER_GUIDE.md');
  const appOperationsLink = appArticle.getByRole('link', { name: 'Anleitung zur Statusprüfung' });
  await expect(appOperationsLink).toHaveCount(1);
  await appOperationsLink.click();
  const appAnchor = ownerPage.locator('main article #status-prüfen');
  await expect(appAnchor).toBeVisible();
  await expect(ownerPage).toHaveURL(/\/#\/docs\/OPERATIONS\.md$/);
  await expect(appAnchor).toBeInViewport();

  await ownerPage.setViewportSize({ width: 390, height: 844 });
  await ownerPage.goto('/#/docs/user/AGENT_SKILL.md');
  const skillGuide = ownerPage.locator('main article');
  const apiHandbookLink = skillGuide.getByRole('link', { name: 'MCP-Werkzeuge', exact: true });
  await expect(apiHandbookLink).toHaveCount(1);
  await apiHandbookLink.click();
  await expect(ownerPage).toHaveURL(/\/#\/docs\/API\.md$/);

  const mcpSection = ownerPage.getByRole('heading', { name: 'MCP-Tools verwenden', level: 2 });
  await expect(mcpSection).toHaveAttribute('id', 'mcp-tools-verwenden');
  await expect(mcpSection).toBeInViewport();
  await (await mcpSection.elementHandle()).waitForElementState('stable');
  const headerBox = await ownerPage.locator('header.sticky').boundingBox();
  const headingBox = await mcpSection.boundingBox();
  expect(headerBox).not.toBeNull();
  expect(headingBox).not.toBeNull();
  expect(headingBox.y).toBeGreaterThan(headerBox.y + headerBox.height);
  expect(await ownerPage.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  const apiToolsScroller = ownerPage.locator('main article .handbook-table').filter({
    has: ownerPage.getByRole('columnheader', { name: 'MCP-Tool', exact: true }),
  });
  await expect(apiToolsScroller).toHaveCount(1);
  const article = ownerPage.locator('main article');
  expect(await article.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await ownerPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expect.poll(() => apiToolsScroller.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  await apiToolsScroller.hover();
  await ownerPage.mouse.wheel(1200, 0);
  await expect.poll(() => apiToolsScroller.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);

  await ownerPage.goto('/#/agents');
  const [skill] = await Promise.all([
    ownerPage.waitForEvent('download'),
    ownerPage.getByRole('link', { name: 'Skill herunterladen' }).click(),
  ]);
  expect(skill.suggestedFilename()).toBe('SKILL.md');
  expect(await text(await skill.createReadStream())).toMatch(/^name: falkenwarte$/m);
  await ownerPage.getByRole('link', { name: 'Agent-Skill einrichten' }).click();
  await expect(ownerPage.locator('main article').getByRole('heading', { level: 1, name: 'Agent-Skill installieren' })).toBeVisible();

  recordEvidence('Das Handbuch ordnet veröffentlichte Benutzer-, Betriebs-, Entwickler- und Fachmodellseiten ein und hält Schema-, Quellen- und Abschnittslinks im statischen und eingebetteten Leser funktionsfähig.', 'Chromium prüfte die aktuelle Navigationsstruktur, ausgeblendete historische HTML-Seiten, Release-Commit-Links zum Repository, lokal ausgelieferte Schemas und Medien sowie einen Umlaut-Anker über beide Handbuchansichten.');
});
