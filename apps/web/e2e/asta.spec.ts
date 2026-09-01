import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/** E2E multi-cliente contra el server real (ver playwright.config.ts). */

async function createRoom(
  request: APIRequestContext,
  config: Record<string, unknown> = {},
): Promise<{ code: string; adminToken: string }> {
  const res = await request.post('/api/rooms', { data: { config } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { code: string; adminToken: string };
}

/** Abre un buzzer en un context propio (un "celular") y entra con nombre de equipo. */
async function joinBuzzer(browser: Browser, code: string, name: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`/sala/${code}`);
  await page.getByPlaceholder('Nombre de equipo').fill(name);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  return page;
}

async function openAdmin(browser: Browser, code: string, adminToken: string): Promise<Page> {
  const ctx = await browser.newContext();
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

/** Llama un jugador desde el listone del admin. */
async function callPlayer(admin: Page, playerName: string): Promise<void> {
  await admin.getByPlaceholder(/Buscar jugador/).fill(playerName);
  await admin
    .locator('li')
    .filter({ hasText: playerName })
    .first()
    .getByRole('button')
    .first()
    .click();
  await admin.getByRole('button', { name: 'Llamar', exact: true }).click();
}

test('subasta completa: llamada, rilanci desde dos celulares, cierre y adjudicación', async ({
  browser,
  request,
}) => {
  const { code, adminToken } = await createRoom(request);

  const [alfa, bravo, carlos] = await Promise.all([
    joinBuzzer(browser, code, 'Alfa'),
    joinBuzzer(browser, code, 'Bravo'),
    joinBuzzer(browser, code, 'Carlos'),
  ]);
  await expect(alfa.getByText('Esperando la próxima llamada')).toBeVisible();

  const admin = await openAdmin(browser, code, adminToken);
  await expect(admin.locator('li').filter({ hasText: 'Alfa' }).first()).toBeVisible();
  await expect(admin.getByText('Participantes · 3')).toBeVisible();

  await callPlayer(admin, 'Dimarco');

  // Los tres celulares ven al jugador llamado.
  for (const page of [alfa, bravo, carlos]) {
    await expect(page.getByRole('heading', { name: 'Dimarco' })).toBeVisible();
  }

  // Alfa abre con el mínimo (1); Bravo relanza (2).
  await alfa.getByRole('button', { name: /Rilancio/ }).click();
  await expect(alfa.getByText('Vas ganando')).toBeVisible();
  await expect(bravo.getByText(/Rilancio/)).toBeVisible();
  await bravo.getByRole('button', { name: /Rilancio/ }).click();
  await expect(bravo.getByText('Vas ganando')).toBeVisible();

  // El admin ve la oferta vigente de Bravo y cierra ya.
  await expect(admin.getByText('Historial de ofertas')).toBeVisible();
  await admin.getByRole('button', { name: /Cerrar ya/ }).click();

  // Adjudicación visible en las tres pantallas.
  await expect(bravo.getByText('¡Es tuyo!')).toBeVisible();
  await expect(alfa.getByText('¡Vendido!')).toBeVisible();
  await expect(alfa.getByText(/Bravo/)).toBeVisible();
  await expect(carlos.getByText('¡Vendido!')).toBeVisible();

  // Créditos actualizados en el panel del admin: Bravo pagó 2 → 498.
  const card = (name: string) =>
    admin.locator('li').filter({ hasText: 'cupos' }).filter({ hasText: name }).first();
  await expect(card('Bravo').getByText('498')).toBeVisible();
  await expect(card('Alfa').getByText('500')).toBeVisible();
});

test('pausa y reanudación visibles en el buzzer', async ({ browser, request }) => {
  const { code, adminToken } = await createRoom(request);
  const buzzer = await joinBuzzer(browser, code, 'Delta');
  const admin = await openAdmin(browser, code, adminToken);

  await callPlayer(admin, 'Bastoni');
  await expect(buzzer.getByRole('heading', { name: 'Bastoni' })).toBeVisible();

  // Primera oferta para entrar en fase de puja, después pausa.
  await buzzer.getByRole('button', { name: /Rilancio/ }).click();
  await admin.getByRole('button', { name: 'Pausar', exact: true }).click();
  await expect(buzzer.getByText('Pausada por el banditore')).toBeVisible();

  await admin.getByRole('button', { name: 'Reanudar', exact: true }).click();
  await expect(buzzer.getByText('Pausada por el banditore')).toHaveCount(0);
  await expect(buzzer.getByText('Cierra en')).toBeVisible();
});

test('modo turnos: sorteo, el turno llama y fuera de turno no puede', async ({
  browser,
  request,
}) => {
  const { code, adminToken } = await createRoom(request, { callMode: 'turns' });
  const uno = await joinBuzzer(browser, code, 'Equipo Uno');
  const dos = await joinBuzzer(browser, code, 'Equipo Dos');
  const admin = await openAdmin(browser, code, adminToken);

  await expect(admin.getByText('Ronda de llamadas')).toBeVisible();
  await expect(admin.getByText('Participantes · 2')).toBeVisible();
  await admin.getByRole('button', { name: 'Sortear orden', exact: true }).click();

  // Exactamente uno de los dos buzzers tiene el turno de llamar.
  const turnoUno = uno.getByText('¡Te toca llamar!');
  const turnoDos = dos.getByText('¡Te toca llamar!');
  await expect
    .poll(async () => (await turnoUno.isVisible()) || (await turnoDos.isVisible()), {
      timeout: 10_000,
    })
    .toBe(true);
  const unoTiene = await turnoUno.isVisible();
  const conTurno = unoTiene ? uno : dos;
  const sinTurno = unoTiene ? dos : uno;

  await expect(sinTurno.getByText('Turno de llamada')).toBeVisible();
  await expect(sinTurno.getByText('¡Te toca llamar!')).toHaveCount(0);
  await expect(sinTurno.getByPlaceholder(/Buscar jugador/)).toHaveCount(0);

  // El del turno elige un jugador desde el celular y lo llama.
  await conTurno.getByPlaceholder(/Buscar jugador/).fill('Maignan');
  await conTurno.getByRole('button', { name: /Maignan/ }).first().click();
  await conTurno.getByRole('button', { name: 'Llamar a subasta' }).click();

  // Arranca la subasta en los dos celulares.
  await expect(sinTurno.getByRole('heading', { name: 'Maignan' })).toBeVisible();
  await expect(conTurno.getByRole('heading', { name: 'Maignan' })).toBeVisible();
});
