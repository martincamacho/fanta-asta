import type { Role } from '@fanta/shared';
import { useT } from '../i18n';

/** Colores por rol, convención fantacalcio: P ámbar, D verde, C azul, A rojo. */
export const ROLE_STYLES: Record<Role, { badge: string; text: string; ring: string }> = {
  P: { badge: 'bg-role-p text-pitch-950', text: 'text-role-p', ring: 'border-role-p' },
  D: { badge: 'bg-role-d text-pitch-950', text: 'text-role-d', ring: 'border-role-d' },
  C: { badge: 'bg-role-c text-pitch-950', text: 'text-role-c', ring: 'border-role-c' },
  A: { badge: 'bg-role-a text-pitch-950', text: 'text-role-a', ring: 'border-role-a' },
};

export function RoleBadge({
  role,
  size = 'md',
  full = false,
}: {
  role: Role;
  size?: 'sm' | 'md' | 'lg';
  full?: boolean;
}) {
  const { t } = useT();
  const sizes = {
    sm: 'h-5 w-5 text-xs',
    md: 'h-7 w-7 text-sm',
    lg: 'h-10 w-10 text-xl',
  } as const;
  const roleName = t(`role.${role}`);
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`${ROLE_STYLES[role].badge} ${sizes[size]} inline-flex items-center justify-center rounded font-display font-bold`}
        aria-label={roleName}
      >
        {role}
      </span>
      {full && <span className={`${ROLE_STYLES[role].text} text-sm`}>{roleName}</span>}
    </span>
  );
}
