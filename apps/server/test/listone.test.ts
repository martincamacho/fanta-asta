import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Role } from '@fanta/shared';
import { loadListone, playersById } from '../src/data/listone.js';

describe('loader del listone', () => {
  it('carga el CSV real con la distribución esperada de roles', () => {
    const players = loadListone();

    const byRole = players.reduce<Record<Role, number>>(
      (acc, p) => {
        acc[p.role] += 1;
        return acc;
      },
      { P: 0, D: 0, C: 0, A: 0 },
    );

    // Archivo real 2026-27 al cierre del mercado (+R. Rodriguez): 538 jugadores únicos
    expect(players.length).toBe(538);
    expect(byRole).toEqual({ P: 64, D: 190, C: 194, A: 90 });

    // ids únicos
    expect(new Set(players.map((p) => p.id)).size).toBe(players.length);

    // spot-check de la primera fila conocida
    const svilar = playersById(players).get(5841);
    expect(svilar).toEqual({ id: 5841, name: 'Svilar', team: 'Roma', role: 'P', quotazione: 19 });
  });

  it('saltea headers duplicados, roles inválidos e ids no numéricos, y deduplica', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fanta-listone-'));
    const file = path.join(dir, 'listone.csv');
    writeFileSync(
      file,
      [
        'C,T,M,Nome,Squadra,Quotazione,ID,EID',
        'P,P,Por,Uno,Roma,10,1,1',
        'C,T,M,Nome,Squadra,Quotazione,ID,EID', // header duplicado en el medio
        'X,X,X,RolInvalido,Roma,5,2,2', // rol inválido
        'D,D,Dd,SinId,Roma,5,abc,3', // id no numérico
        'D,D,Dd,Dos,Milan,7,4,4',
        'D,D,Dd,DosDuplicado,Milan,9,4,4', // id repetido → se ignora
        '',
        'C,C,M,Tres,Inter,12,5,5', // mediocampista legítimo (empieza con C pero no es header)
      ].join('\n'),
    );

    const players = loadListone(file);
    expect(players.map((p) => p.id)).toEqual([1, 4, 5]);
    expect(players[1]).toEqual({ id: 4, name: 'Dos', team: 'Milan', role: 'D', quotazione: 7 });
    expect(players[2]?.role).toBe('C');
  });
});
