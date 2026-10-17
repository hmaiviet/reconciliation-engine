import { describe, expect, it } from 'vitest';
import { parseTimestamp } from '../../src/domain/types.js';

describe('timestamps (D5, D7)', () => {
  it.each([
    ['1970-01-01T00:00:00Z', '0'],
    ['1970-01-01T00:00:01.5Z', '1.5'],
    ['2026-01-01T10:00:00.000Z', '1767261600'],
    ['2026-01-01T10:00:00.123456789Z', '1767261600.123456789'],
    ['2028-02-29T00:00:00Z', '1835395200'],
  ])('timestamp: %s is %s epoch seconds without precision loss', (text, seconds) => {
    expect(parseTimestamp(text)?.toString()).toBe(seconds);
  });

  it.each([
    '2026-01-01T10:00:00+01:00',
    '2026-01-01T10:00:00.000',
    '2026-01-01T10:00:00z',
    '2026-01-01 10:00:00Z',
    '2026-1-01T10:00:00Z',
    '2026-02-30T10:00:00Z',
    '2026-02-29T10:00:00Z',
    '2026-13-01T10:00:00Z',
    '2026-01-01T24:00:00Z',
    '2026-01-01T10:60:00Z',
    '2026-01-01T10:00:00.Z',
    '',
  ])('timestamp: %j is rejected', (text) => {
    expect(parseTimestamp(text)).toBeNull();
  });
});
