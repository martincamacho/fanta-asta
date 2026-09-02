import type { ReactNode, SVGProps } from 'react';

/** Set propio de íconos inline estilo FantaLab (nada copiado: dibujados a mano).
 *  Trazo consistente 2px, esquinas redondeadas, 1em y currentColor: heredan
 *  tamaño y color del texto al que acompañan (violeta/lima del tema). */
export type IconName = 'coin' | 'gavel' | 'clock' | 'star' | 'trendUp' | 'shirt' | 'pause';

const PATHS: Record<IconName, ReactNode> = {
  /** Moneda de créditos: círculo con "C" adentro (estilo FantaLab). */
  coin: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M14.6 9.6a3.6 3.6 0 1 0 0 4.8" />
    </>
  ),
  /** Martillo de subasta (aggiudicato / chiudi ora). */
  gavel: (
    <>
      <path d="M12 5.5 18.5 12" />
      <path d="M8.5 9 15 15.5" />
      <path d="M12 5.5 8.5 9" />
      <path d="M18.5 12 15 15.5" />
      <path d="M10.75 12.75 4 19.5" />
    </>
  ),
  /** Cronómetro del cierre. */
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  /** Estrella de la watchlist (fill=currentColor cuando está activa). */
  star: (
    <path d="m12 3.5 2.5 5.1 5.6.8-4 4 .9 5.6-5-2.7-5 2.7.9-5.6-4-4 5.6-.8z" />
  ),
  /** Tendencia: oferta por encima de la quotazione. */
  trendUp: (
    <>
      <path d="m3.5 16.5 5.5-5.5 3.5 3.5 7-7" />
      <path d="M14.5 7.5h5v5" />
    </>
  ),
  /** Camiseta del equipo. */
  shirt: (
    <path d="M9.2 4.5 4 7.3l1.8 3.5 2.2-1v9.7h8V9.8l2.2 1L20 7.3l-5.2-2.8a2.8 2.8 0 0 1-5.6 0z" />
  ),
  /** Pausa del banditore. */
  pause: (
    <>
      <path d="M9.5 6.5v11" />
      <path d="M14.5 6.5v11" />
    </>
  ),
};

export function Icon({
  name,
  className = '',
  ...rest
}: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`inline-block shrink-0 align-[-0.125em] ${className}`}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
