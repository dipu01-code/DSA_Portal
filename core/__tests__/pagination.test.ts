import {
  encodeCursor,
  decodeCursor,
  buildKeysetClause,
  paginateKeyset,
} from '../src/storage/pagination';

describe('Keyset Pagination Utilities', () => {
  test('encodeCursor and decodeCursor round-trip', () => {
    const payload = {
      createdAt: '2026-11-14T07:00:00.000Z',
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    };
    const cursor = encodeCursor(payload);
    expect(typeof cursor).toBe('string');

    const decoded = decodeCursor<typeof payload>(cursor);
    expect(decoded).toEqual(payload);
  });

  test('decodeCursor returns null for invalid input', () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor('not-valid-base64-json!')).toBeNull();
  });

  test('buildKeysetClause constructs row constructor comparisons', () => {
    const clauseDesc = buildKeysetClause('DESC', ['created_at', 'id'], ['2026-11-14T00:00:00Z', 'uuid-123']);
    expect(clauseDesc.sql).toBe('(created_at, id) < ($1, $2)');
    expect(clauseDesc.params).toEqual(['2026-11-14T00:00:00Z', 'uuid-123']);

    const clauseAsc = buildKeysetClause('ASC', ['rank', 'score'], [10, 250], 3);
    expect(clauseAsc.sql).toBe('(rank, score) > ($3, $4)');
    expect(clauseAsc.params).toEqual([10, 250]);
  });

  test('paginateKeyset correctly slices items and generates nextCursor', () => {
    const rawItems = [
      { id: '1', createdAt: '2026-11-14T10:00:00Z' },
      { id: '2', createdAt: '2026-11-14T09:00:00Z' },
      { id: '3', createdAt: '2026-11-14T08:00:00Z' }, // 3rd item indicates hasNextPage when limit=2
    ];

    const page = paginateKeyset(rawItems, 2, (item) => ({
      id: item.id,
      createdAt: item.createdAt,
    }));

    expect(page.items.length).toBe(2);
    expect(page.hasNextPage).toBe(true);
    expect(page.nextCursor).toBeDefined();

    const decoded = decodeCursor<any>(page.nextCursor);
    expect(decoded.id).toBe('2');
  });
});
