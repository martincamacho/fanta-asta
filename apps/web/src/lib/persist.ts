/** Persistencia por sala en localStorage: participantId + nombre + adminToken. */

function key(code: string, field: string): string {
  return `fanta:${code.toUpperCase()}:${field}`;
}

function read(code: string, field: string): string | null {
  try {
    return localStorage.getItem(key(code, field));
  } catch {
    return null;
  }
}

function write(code: string, field: string, value: string): void {
  try {
    localStorage.setItem(key(code, field), value);
  } catch {
    /* modo privado sin storage: la sesión sigue, solo no persiste */
  }
}

export interface StoredTicket {
  participantId: string;
  name: string;
}

export const persist = {
  getParticipantId: (code: string) => read(code, 'participantId'),
  setParticipantId: (code: string, id: string) => write(code, 'participantId', id),
  getName: (code: string) => read(code, 'name'),
  setName: (code: string, name: string) => write(code, 'name', name),
  getAdminToken: (code: string) => read(code, 'adminToken'),
  setAdminToken: (code: string, token: string) => write(code, 'adminToken', token),
  /** Ticket de sala de liga (identidad estable) — para reconectar sin re-pedirlo. */
  getTicket: (code: string): StoredTicket | null => {
    const raw = read(code, 'ticket');
    if (!raw) return null;
    try {
      const t = JSON.parse(raw) as Partial<StoredTicket>;
      if (typeof t.participantId === 'string' && typeof t.name === 'string') {
        return { participantId: t.participantId, name: t.name };
      }
    } catch {
      /* ticket corrupto: se ignora */
    }
    return null;
  },
  setTicket: (code: string, ticket: StoredTicket) => write(code, 'ticket', JSON.stringify(ticket)),
};
