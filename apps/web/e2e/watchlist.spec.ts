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

  // El filtro "Solo watchlist" lo agrupa por rol y muestra la suma estimada.
  await panel.getByRole('button', { name: /Solo watchlist/ }).click();
  await expect(panel.getByText('Stima totale 30 cr · ti restano 500').first()).toBeVisible();

  // El admin lo llama a subasta: el buzzer lo marca solo para este usuario.
  const admin = await openAdmin(browser, code, adminToken);
  await admin.getByPlaceholder(/Cerca giocatore/).fill('Dimarco');
  await admin.locator('li').filter({ hasText: 'Dimarco' }).first().getByRole('button').first().click();
  await admin.getByRole('button', { name: 'Chiama', exact: true }).click();

  await expect(buzzer.getByRole('heading', { name: 'Dimarco' })).toBeVisible();
  await expect(buzzer.getByText('In watchlist · max 30 cr')).toBeVisible();
});
