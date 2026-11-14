/**
 * Hybrid Logical Clock (HLC) Implementation
 *
 * Based on Kulkarni et al. (2014): "Logical Physical Clocks and Consistent Snapshots in Globally Distributed Databases"
 * Guarantees:
 * 1. Strict causal ordering ($e \rightarrow f \implies HLC(e) < HLC(f)$)
 * 2. Close adherence to physical wall-clock time
 * 3. Bounded clock drift resilience
 */

import type { HybridLogicalClock } from './types';

export const HLC_DELIMITER = '.';

/**
 * Parses an HLC string ("<physical_ms>.<logical_counter>.<device_id>") into its components.
 */
export function parseHlc(hlcString: string): HybridLogicalClock {
  const parts = hlcString.split(HLC_DELIMITER);
  if (parts.length !== 3) {
    throw new Error(
      `Invalid HLC format: "${hlcString}". Expected "physical_ms.logical_c.device_id"`
    );
  }

  const l = Number(parts[0]);
  const c = Number(parts[1]);
  const d = parts[2];

  if (Number.isNaN(l) || Number.isNaN(c) || !d) {
    throw new Error(`Invalid HLC values in: "${hlcString}"`);
  }

  return { l, c, d };
}

/**
 * Formats an HLC object into a zero-padded string representation for canonical lexicographic sorting.
 * Format: 13-digit physical ms, 5-digit logical counter, device id.
 */
export function formatHlc(hlc: HybridLogicalClock): string {
  const lStr = hlc.l.toString().padStart(13, '0');
  const cStr = hlc.c.toString().padStart(5, '0');
  return `${lStr}.${cStr}.${hlc.d}`;
}

/**
 * Compares two HLC instances or strings.
 * Returns:
 *  -1 if a < b
 *   0 if a == b
 *   1 if a > b
 */
export function compareHlc(a: HybridLogicalClock | string, b: HybridLogicalClock | string): number {
  const hlcA = typeof a === 'string' ? parseHlc(a) : a;
  const hlcB = typeof b === 'string' ? parseHlc(b) : b;

  if (hlcA.l !== hlcB.l) {
    return hlcA.l < hlcB.l ? -1 : 1;
  }

  if (hlcA.c !== hlcB.c) {
    return hlcA.c < hlcB.c ? -1 : 1;
  }

  if (hlcA.d !== hlcB.d) {
    return hlcA.d < hlcB.d ? -1 : 1;
  }

  return 0;
}

/**
 * Generates the next monotonic HLC for a local mutation event.
 */
export function generateNextHlc(
  lastHlc: HybridLogicalClock | null | undefined,
  deviceId: string,
  physicalNow: number = Date.now()
): HybridLogicalClock {
  if (!lastHlc) {
    return { l: physicalNow, c: 0, d: deviceId };
  }

  const l = Math.max(lastHlc.l, physicalNow);
  let c = 0;

  if (l === lastHlc.l) {
    c = lastHlc.c + 1;
  } else {
    c = 0;
  }

  return { l, c, d: deviceId };
}

/**
 * Updates local HLC upon receiving a remote operation from the network.
 */
export function receiveHlc(
  localHlc: HybridLogicalClock,
  remoteHlc: HybridLogicalClock,
  deviceId: string,
  physicalNow: number = Date.now()
): HybridLogicalClock {
  const lPrime = Math.max(localHlc.l, remoteHlc.l, physicalNow);
  let cPrime = 0;

  if (lPrime === localHlc.l && lPrime === remoteHlc.l) {
    cPrime = Math.max(localHlc.c, remoteHlc.c) + 1;
  } else if (lPrime === localHlc.l) {
    cPrime = localHlc.c + 1;
  } else if (lPrime === remoteHlc.l) {
    cPrime = remoteHlc.c + 1;
  } else {
    cPrime = 0;
  }

  return { l: lPrime, c: cPrime, d: deviceId };
}
