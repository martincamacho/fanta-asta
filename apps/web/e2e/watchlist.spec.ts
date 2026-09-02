import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/** Watchlist privada: seguir un jugador desde la pestaña Listone del buzzer con
 *  budget estimado y verlo marcado cuando sale a subasta. (UI en italiano.) */

async function createRoom(
  request: APIRequestContext,
): Promise<{ code: string; adminToken: string }> {
  const res = await request.post('/api/rooms', { data: { config: {} } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { code: string; adminToken: string };
}

/** El buzzer es un celular: viewport móvil (el toggle "Solo watchlist" es solo <lg;
 *  en desktop la watchlist vive en el panel lateral siempre visible). */
async function joinBuzzer(browser: Browser, code: string, name: string): Promise<Page> {
  const ctx = await browser.newContext({ locale: 'it-IT', viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(`/sala/${code}`);
  await page.getByRole('button', { name: 'Continua senza account' }).click();
  await page.getByPlaceholder('Nome della squadra').fill(name);
  await page.getByRole('button', { name: 'Entra', exact: true }).click();
  return page;
}

async function openAdmin(browser: Browser, code: string, adminToken: string): Promise<Page> {
  const ctx = await browser.newContext({ locale: 'it-IT' });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.evaluate(
    ([c, t]) => localStorage.setItem(`fanta:${c}:adminToken`, t as string),
    [code.toUpperCase(), adminToken],
  );
  await page.goto(`/admin/${code}`);
  await expect(page.getByRole('heading', { name: 'Listone', exact: true })).toBeVisible();
  return page;
}

test('watchlist: seguir desde el listone con budget y verlo marcado al ser llamado', async ({
  browser,
  request,
}) => {
  const { code, adminToken } = await createRoom(request);
  const buzzer = await joinBuzzer(browser, code, 'Echo');
  await expect(buzzer.getByText('In attesa della prossima chiamata')).toBeVisible();

  // Pestaña Listone: buscar, seguir con la estrella y estimar budget.
  await buzzer.getByRole('tab', { name: 'Listone' }).click();
  const panel = buzzer.getByRole('tabpanel');
  await panel.getByPlaceholder(/Cerca giocatore/).fill('Dimarco');
  await expect(panel.getByText('Dimarco')).toBeVisible();
  await panel.getByRole('button', { name: 'Segui Dimarco' }).click();
  // .first(): el panel lateral de desktop existe oculto en el DOM (hidden lg:block).
  await panel.getByLabel('Budget stimato per Dimarco').first().fill('30');
  // Otro difensore para la prueba de grupos de más abajo.
  await panel.getByPlaceholder(/Cerca giocatore/).fill('Bastoni');
  await panel.getByRole('button', { name: 'Segui Bastoni' }).click();

  // El filtro "Solo watchlist" abre la pizarra y muestra la suma estimada.
  await panel.getByRole('button', { name: /Solo watchlist/ }).click();
  await expect(panel.getByText('Stima totale 30 cr · ti restano 500').first()).toBeVisible();

  // Pizarra: Dimarco espera en "Da sistemare"; lo ubicamos en el primer slot D con el
  // picker móvil y le ponemos una etiqueta libre. (.first(): el panel desktop, oculto
  // en 390px, duplica la pizarra en el DOM.)
  await expect(panel.getByText('Da sistemare').first()).toBeVisible();
  await panel.getByRole('button', { name: 'Slot D 1', exact: true }).first().click();
  await panel.getByRole('button', { name: 'Metti Dimarco in questo slot' }).first().click();
  const nota = panel.getByLabel('Nota per Dimarco').first();
  await nota.fill('titolare');

  // Recarga: el slot asignado y la nota persisten.
  await buzzer.reload();
  await buzzer.getByRole('tab', { name: 'Listone' }).click();
  const panel2 = buzzer.getByRole('tabpanel');
  await panel2.getByRole('button', { name: /Solo watchlist/ }).click();
  await expect(panel2.getByLabel('Nota per Dimarco').first()).toHaveValue('titolare');
  // El slot 1 de D quedó ocupado (ya no hay casilla vacía 1); el 2 sigue libre.
  await expect(panel2.getByRole('button', { name: 'Slot D 1', exact: true })).toHaveCount(0);
  await expect(
    panel2.getByRole('button', { name: 'Slot D 2', exact: true }).first(),
  ).toBeVisible();

  // GRUPOS: creamos "Low cost" dentro de D y ubicamos ahí a Bastoni con el picker.
  await panel2.getByRole('button', { name: 'Aggiungi gruppo in D' }).first().click();
  await panel2.getByLabel('Nome del gruppo').first().fill('Low cost');
  await panel2.getByLabel('Nome del gruppo').first().press('Enter');
  await panel2
    .getByRole('button', { name: 'Slot D 1 in Low cost', exact: true })
    .first()
    .click();
  await panel2.getByRole('button', { name: 'Metti Bastoni in questo slot' }).first().click();
  await expect(panel2.getByLabel('Nota per Bastoni').first()).toBeVisible();

  // Segunda recarga: el nombre del grupo y la asignación adentro persisten.
  await buzzer.reload();
  await buzzer.getByRole('tab', { name: 'Listone' }).click();
  const panel3 = buzzer.getByRole('tabpanel');
  await panel3.getByRole('button', { name: /Solo watchlist/ }).click();
  await expect(panel3.getByLabel('Nome del gruppo').first()).toHaveValue('Low cost');
  await expect(panel3.getByLabel('Nota per Bastoni').first()).toBeVisible();
  await expect(
    panel3.getByRole('button', { name: 'Slot D 1 in Low cost', exact: true }),
  ).toHaveCount(0);

  // El admin lo llama a subasta: el buzzer lo marca solo para este usuario.
  const admin = await openAdmin(browser, code, adminToken);
  await admin.getByPlaceholder(/Cerca giocatore/).fill('Dimarco');
  await admin.locator('li').filter({ hasText: 'Dimarco' }).first().getByRole('button').first().click();
  await admin.getByRole('button', { name: 'Chiama', exact: true }).click();

  await expect(buzzer.getByRole('heading', { name: 'Dimarco' })).toBeVisible();
  await expect(buzzer.getByText('In watchlist · max 30 cr')).toBeVisible();
});
