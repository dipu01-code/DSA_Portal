import { parseHlc, formatHlc, compareHlc, generateNextHlc, receiveHlc } from '../../src/sync/hlc';

describe('Hybrid Logical Clock (HLC)', () => {
  const deviceA = 'devA';
  const deviceB = 'devB';

  test('parseHlc and formatHlc round-trip', () => {
    const raw = '0001731427200.00005.devA';
    const parsed = parseHlc(raw);
    expect(parsed.l).toBe(1731427200);
    expect(parsed.c).toBe(5);
    expect(parsed.d).toBe('devA');

    const formatted = formatHlc(parsed);
    expect(formatted).toBe('0001731427200.00005.devA');
  });

  test('generateNextHlc increments counter when physical clock has not advanced', () => {
    const t0 = 10000;
    const hlc1 = generateNextHlc(null, deviceA, t0);
    expect(hlc1).toEqual({ l: t0, c: 0, d: deviceA });

    const hlc2 = generateNextHlc(hlc1, deviceA, t0);
    expect(hlc2).toEqual({ l: t0, c: 1, d: deviceA });

    const hlc3 = generateNextHlc(hlc2, deviceA, t0);
    expect(hlc3).toEqual({ l: t0, c: 2, d: deviceA });
  });

  test('generateNextHlc resets counter when physical clock advances', () => {
    const hlc1 = generateNextHlc(null, deviceA, 10000);
    const hlc2 = generateNextHlc(hlc1, deviceA, 10000);
    expect(hlc2.c).toBe(1);

    const hlc3 = generateNextHlc(hlc2, deviceA, 10005);
    expect(hlc3).toEqual({ l: 10005, c: 0, d: deviceA });
  });

  test('receiveHlc advances clock to max of local, remote and physical time', () => {
    const local = { l: 10000, c: 2, d: deviceA };
    const remote = { l: 10005, c: 1, d: deviceB };

    // Case 1: physical clock behind remote clock
    const updated1 = receiveHlc(local, remote, deviceA, 10002);
    expect(updated1.l).toBe(10005);
    expect(updated1.c).toBe(2);

    // Case 2: physical clock ahead of both
    const updated2 = receiveHlc(local, remote, deviceA, 10020);
    expect(updated2.l).toBe(10020);
    expect(updated2.c).toBe(0);
  });

  test('compareHlc correctly orders clocks', () => {
    const clock1 = { l: 1000, c: 0, d: 'devA' };
    const clock2 = { l: 1000, c: 1, d: 'devA' };
    const clock3 = { l: 1001, c: 0, d: 'devA' };
    const clock4 = { l: 1001, c: 0, d: 'devB' };

    expect(compareHlc(clock1, clock2)).toBe(-1);
    expect(compareHlc(clock2, clock1)).toBe(1);
    expect(compareHlc(clock1, clock1)).toBe(0);
    expect(compareHlc(clock2, clock3)).toBe(-1);
    expect(compareHlc(clock3, clock4)).toBe(-1); // Tie-break by device id ('devA' < 'devB')
  });
});
