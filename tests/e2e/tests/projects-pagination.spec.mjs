import { test, expect, recordEvidence } from '../support/fixtures.mjs';

test('project overview includes projects beyond the first API page', async ({ ownerApi, ownerPage }) => {
  test.info().annotations.push({
    type: 'expected',
    description: 'Die Projektübersicht lädt API-Folgeseiten und zeigt das 101. Projekt.',
  });

  let finalProject;
  for (let number = 1; number <= 101; number += 1) {
    finalProject = await ownerApi.createProject({
      slug: `qa-pagination-${String(number).padStart(3, '0')}`,
      name: `Pagination Projekt ${String(number).padStart(3, '0')}`,
    });
  }

  await ownerPage.goto('/#/projects');
  await expect(ownerPage.getByRole('heading', { name: finalProject.name, exact: true })).toBeVisible();

  recordEvidence(
    'Die Projektübersicht zeigt auch Einträge jenseits der API-Seitengrenze von 100 Projekten.',
    `Nach der Anlage von 101 Projekten zeigte Chromium das letzte Projekt ${finalProject.slug} in der Projektübersicht.`,
  );
});
