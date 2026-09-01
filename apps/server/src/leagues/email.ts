/**
 * Envío de emails de invitación vía Resend (https://resend.com).
 * Apagado sin RESEND_API_KEY: sendInviteEmail devuelve false sin llamar a nada.
 * Un fallo de email NUNCA rompe la creación del invite (solo emailSent: false).
 */
export interface InviteEmail {
  to: string;
  leagueName: string;
  /** Link completo de la invitación (<origin>/invitacion/<token>). */
  url: string;
}

export async function sendInviteEmail(invite: InviteEmail): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM ?? 'Fanta Asta <onboarding@resend.dev>',
        to: [invite.to],
        subject: `Sei stato invitato alla lega ${invite.leagueName}`,
        html: buildHtml(invite),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function buildHtml({ leagueName, url }: InviteEmail): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="margin: 0 0 8px;">⚽ Fanta Asta</h2>
      <p>Unisciti alla lega <strong>${esc(leagueName)}</strong>: l'asta ti aspetta,
         prepara la rosa e i crediti!</p>
      <p style="margin: 24px 0;">
        <a href="${url}" style="background: #16a34a; color: #fff; padding: 12px 24px;
           border-radius: 8px; text-decoration: none; font-weight: bold;">Accetta l'invito</a>
      </p>
      <p style="color: #666; font-size: 13px;">
        Se il pulsante non funziona, copia questo link nel browser:<br>
        <a href="${url}">${url}</a>
      </p>
    </div>`;
}
