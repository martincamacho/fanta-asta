import { useEffect, useState } from 'react';
import type { Player } from '@fanta/shared';
import { ROLE_STYLES } from './RoleBadge';

/** Card del jugador (/campioncini/<id>.png, ~270x380). Si falla, placeholder propio
 *  con la inicial del jugador sobre el color de su rol. */
export function PlayerImg({ player, className = '' }: { player: Player; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [player.id]);

  if (failed) {
    return (
      <div
        className={`${className} ${ROLE_STYLES[player.role].ring} flex aspect-[270/380] items-center justify-center rounded-xl border-2 bg-pitch-800 [container-type:inline-size]`}
        role="img"
        aria-label={player.name}
      >
        <span className={`${ROLE_STYLES[player.role].text} font-display text-[48cqw] font-bold leading-none`}>
          {player.name.charAt(0).toUpperCase()}
        </span>
      </div>
    );
  }
  return (
    <img
      src={`/campioncini/${player.id}.png`}
      alt={player.name}
      className={`${className} aspect-[270/380] rounded-xl object-contain`}
      onError={() => setFailed(true)}
      draggable={false}
    />
  );
}
