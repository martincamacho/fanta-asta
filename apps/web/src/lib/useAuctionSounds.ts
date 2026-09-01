import { useEffect, useRef } from 'react';
import type { RoomState } from '@fanta/shared';
import { useStore } from '../store';
import { auctionTimerMs, useCountdown } from './useCountdown';
import { sound } from './sound';

/** Sonidos del banditore: beeps en los últimos 3s, martillazo en sold,
 *  y (opcional, tablero) blip por cada oferta nueva. */
export function useAuctionSounds(
  state: RoomState | null,
  enabled: boolean,
  opts: { bidBlip?: boolean } = {},
): void {
  const lastEvent = useStore((s) => s.lastEvent);
  const eventSeq = useStore((s) => s.eventSeq);
  const bidBlip = opts.bidBlip ?? false;

  // eventos: sold / bid
  const prevSeq = useRef(eventSeq);
  useEffect(() => {
    if (eventSeq === prevSeq.current) return;
    prevSeq.current = eventSeq;
    if (!enabled || !lastEvent) return;
    if (lastEvent.type === 'sold') sound.sold();
    else if (lastEvent.type === 'bid' && bidBlip) sound.blip();
  }, [eventSeq, lastEvent, enabled, bidBlip]);

  // countdown: un beep por segundo en 3-2-1, el último más agudo
  const auctionActive =
    state !== null &&
    (state.auction.phase === 'called' || state.auction.phase === 'bidding') &&
    state.auction.pausedRemainingMs === null;
  const { remainingMs, active } = useCountdown(
    auctionActive ? state.auction.deadline : null,
    state ? auctionTimerMs(state) : 0,
  );
  const lastBeep = useRef<number | null>(null);
  useEffect(() => {
    if (!enabled || !active) {
      lastBeep.current = null;
      return;
    }
    const sec = Math.ceil(remainingMs / 1000);
    if (sec >= 1 && sec <= 3 && lastBeep.current !== sec) {
      lastBeep.current = sec;
      sound.tick(sec === 1);
    }
  }, [remainingMs, active, enabled]);
}
