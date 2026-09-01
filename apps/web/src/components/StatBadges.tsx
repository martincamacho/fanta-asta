import type { PlayerProfile } from '@fanta/shared';

/** Fila de badges MV / FM / FVM, como los de la ficha oficial. */
export function StatBadges({
  profile,
  compact = false,
}: {
  profile: PlayerProfile | null;
  compact?: boolean;
}) {
  if (!profile) return null;
  const items: Array<{ label: string; value: number | null; cls: string }> = [
    { label: 'MV', value: profile.mv, cls: 'bg-primary text-white' },
    { label: 'FM', value: profile.fm, cls: 'bg-secondary text-navy' },
    { label: 'FVM', value: profile.fvm, cls: 'bg-alt text-white' },
  ];
  const visible = items.filter((i) => i.value !== null);
  if (visible.length === 0) return null;
  const pad = compact ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-xs';
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {visible.map((i) => (
        <span
          key={i.label}
          className={`${i.cls} ${pad} tabular inline-flex items-baseline gap-1 rounded font-bold`}
        >
          {i.label}
          <span className="font-display text-[1.15em]">{i.value}</span>
        </span>
      ))}
    </span>
  );
}
