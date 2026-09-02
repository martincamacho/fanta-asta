import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/** E2E multi-cliente contra el server real (ver playwright.config.ts).
 *  La UI está en italiano por defecto (sin localStorage 'fanta:lang'). */

async function createRoom(
  request: APIRequestContext,
  config: Record<string, unknown> = {},
): Promise<{ code: string; adminToken: string }> {
  const res = await request.post('/api/rooms', { data: { config } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { code: string; adminToken: string };
}

/** Abre un buzzer en un context propio (un "celular") y entra por el flujo anónimo
 *  ("Continua senza account"): solo nombre de equipo. */
async function joinBuzzer(browser: Browser, code: string, name: string): Promise<Page> {
  const ctx = await browser.newContext({ locale: 'it-IT' });
  const page = await ctx.newPage();
  await page.goto(`/sala/${code}`);
  await page.getByRole('button', { name: 'Continua senza account' }).click();
  await page.getByPlaceholder('Nome della squadra').fill(name);
  await page.getByRole('button', { name: 'Entra', exact: true }).click();
  return page;
}

/** Entra por el gate unificado con email (claim passwordless-lite). */
async function joinWithEmail(
  browser: Browser,
  code: string,
  email: string,
  name: string,
): Promise<Page> {
  const ctx = await browser.newContext({ locale: 'it-IT' });
  const page = await ctx.newPage();
  await page.goto(`/sala/${code}`);
  await page.getByPlaceholder('tu@esempio.com').fill(email);
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

/** Llama un jugador desde el listone del admin. */
async function callPlayer(admin: Page, playerName: string): Promise<void> {
  await admin.getByPlaceholder(/Cerca giocatore/).fill(playerName);
  await admin
    .locator('li')
    .filter({ hasText: playerName })
    .first()
    .getByRole('button')
    .first()
    .click();
  await admin.getByRole('button', { name: 'Chiama', exact: true }).click();
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
  await expect(alfa.getByText('In attesa della prossima chiamata')).toBeVisible();

  const admin = await openAdmin(browser, code, adminToken);
  await expect(admin.locator('li').filter({ hasText: 'Alfa' }).first()).toBeVisible();
  await expect(admin.getByText('Partecipanti · 3')).toBeVisible();

  await callPlayer(admin, 'Dimarco');

  // Los tres celulares ven al jugador llamado.
  for (const page of [alfa, bravo, carlos]) {
    await expect(page.getByRole('heading', { name: 'Dimarco' })).toBeVisible();
  }

  // Alfa abre con el mínimo (1); Bravo relanza (2).
  await alfa.getByRole('button', { name: /Rilancia/ }).click();
  await expect(alfa.getByText('Stai vincendo')).toBeVisible();
  await expect(bravo.getByText(/Rilancia/)).toBeVisible();
  await bravo.getByRole('button', { name: /Rilancia/ }).click();
  await expect(bravo.getByText('Stai vincendo')).toBeVisible();

  // Rilancio rápido: Alfa toca "+5" y la oferta queda en vigente+5 (2 → 7).
  await alfa.getByRole('button', { name: '+5 · 7' }).click();
  await expect(alfa.getByText('Stai vincendo')).toBeVisible();
  // Bravo ve la vigente en 7: su "+5" ahora ofrece 12 y el héroe pide 8.
  await expect(bravo.getByRole('button', { name: '+5 · 12' })).toBeVisible();
  await bravo.getByRole('button', { name: /Rilancia/ }).click();
  await expect(bravo.getByText('Stai vincendo')).toBeVisible();

  // El admin ve la oferta vigente de Bravo y cierra ya.
  await expect(admin.getByText('Storico delle offerte')).toBeVisible();
  await admin.getByRole('button', { name: /Chiudi ora/ }).click();

  // Adjudicación visible en las tres pantallas.
  await expect(bravo.getByText('È tuo!')).toBeVisible();
  await expect(alfa.getByText('Venduto!')).toBeVisible();
  await expect(alfa.getByText(/Bravo/)).toBeVisible();
  await expect(carlos.getByText('Venduto!')).toBeVisible();

  // Créditos actualizados en el panel del admin: Bravo pagó 8 → 492.
  const card = (name: string) =>
    admin.locator('li').filter({ hasText: 'slot' }).filter({ hasText: name }).first();
  await expect(card('Bravo').getByText('492')).toBeVisible();
  await expect(card('Alfa').getByText('500')).toBeVisible();

  // La pestaña "La mia rosa" del comprador muestra el jugador comprado con su precio
  // y el progreso del rol actualizado (Dimarco es difensore: D 1/8).
  await bravo.getByRole('tab', { name: 'La mia rosa' }).click();
  const rosa = bravo.getByRole('tabpanel');
  await expect(rosa.getByText('Crediti rimanenti')).toBeVisible();
  await expect(rosa.getByText('492', { exact: true })).toBeVisible();
  await expect(rosa.getByText('D 1/8')).toBeVisible();
  const fila = rosa.locator('li').filter({ hasText: 'Dimarco' }).first();
  await expect(fila).toBeVisible();
  await expect(fila.getByText('8', { exact: true })).toBeVisible();

  // La pestaña "Squadre" de otro celular lista a Bravo con sus créditos restantes.
  await alfa.getByRole('tab', { name: 'Squadre' }).click();
  const squadre = alfa.getByRole('tabpanel');
  await expect(squadre.getByText('Bravo')).toBeVisible();
  await expect(squadre.getByText('492')).toBeVisible();
});

test('pausa y reanudación visibles en el buzzer', async ({ browser, request }) => {
  const { code, adminToken } = await createRoom(request);
  const buzzer = await joinBuzzer(browser, code, 'Delta');
  const admin = await openAdmin(browser, code, adminToken);

  await callPlayer(admin, 'Bastoni');
  await expect(buzzer.getByRole('heading', { name: 'Bastoni' })).toBeVisible();

  // Primera oferta para entrar en fase de puja, después pausa.
  await buzzer.getByRole('button', { name: /Rilancia/ }).click();
  await admin.getByRole('button', { name: 'Pausa', exact: true }).click();
  await expect(buzzer.getByText('In pausa dal banditore')).toBeVisible();

  await admin.getByRole('button', { name: 'Riprendi', exact: true }).click();
  await expect(buzzer.getByText('In pausa dal banditore')).toHaveCount(0);
  await expect(buzzer.getByText('Chiude tra')).toBeVisible();
});

test('claim por email: el mismo equipo vuelve desde otro dispositivo', async ({
  browser,
  request,
}) => {
  const { code } = await createRoom(request);
  const email = `claim-${Date.now()}@test.com`;

  // Dispositivo 1: entra con email + nombre de equipo (crea la cuenta passwordless).
  const uno = await joinWithEmail(browser, code, email, 'La Remontada');
  await expect(uno.getByText('La mia squadra · La Remontada')).toBeVisible();
  await uno.context().close();

  // Dispositivo 2 (context limpio): mismo email → mismo equipo, aunque tipee otro nombre.
  const dos = await joinWithEmail(browser, code, email, 'Otro Nombre');
  await expect(dos.getByText('La mia squadra · La Remontada')).toBeVisible();
  await dos.context().close();
});

test('modo turnos: sorteo, el turno llama y fuera de turno no puede', async ({
  browser,
  request,
}) => {
  const { code, adminToken } = await createRoom(request, { callMode: 'turns' });
  const uno = await joinBuzzer(browser, code, 'Equipo Uno');
  const dos = await joinBuzzer(browser, code, 'Equipo Dos');
  const admin = await openAdmin(browser, code, adminToken);

  await expect(admin.getByRole('heading', { name: 'Giro di chiamata' })).toBeVisible();
  await expect(admin.getByText('Partecipanti · 2')).toBeVisible();
  await admin.getByRole('button', { name: "Sorteggia l'ordine", exact: true }).click();

  // Exactamente uno de los dos buzzers tiene el turno de llamar.
  const turnoUno = uno.getByText('Tocca a te chiamare!');
  const turnoDos = dos.getByText('Tocca a te chiamare!');
  await expect
    .poll(async () => (await turnoUno.isVisible()) || (await turnoDos.isVisible()), {
      timeout: 10_000,
    })
    .toBe(true);
  const unoTiene = await turnoUno.isVisible();
  const conTurno = unoTiene ? uno : dos;
  const sinTurno = unoTiene ? dos : uno;

  await expect(sinTurno.getByText('Turno di chiamata')).toBeVisible();
  await expect(sinTurno.getByText('Tocca a te chiamare!')).toHaveCount(0);
  await expect(sinTurno.getByPlaceholder(/Cerca giocatore/)).toHaveCount(0);

  // El del turno elige un jugador desde el celular y lo llama.
  await conTurno.getByPlaceholder(/Cerca giocatore/).fill('Maignan');
  await conTurno.getByRole('button', { name: /Maignan/ }).first().click();
  await conTurno.getByRole('button', { name: "Chiama all'asta" }).click();

  // Arranca la subasta en los dos celulares.
  await expect(sinTurno.getByRole('heading', { name: 'Maignan' })).toBeVisible();
  await expect(conTurno.getByRole('heading', { name: 'Maignan' })).toBeVisible();
});
