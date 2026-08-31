import { describe, expect, it } from 'vitest';

import { buildSnapshot, restoreSnapshot } from '@/lib/db/backup';
import { setApiKey, setSetting } from '@/lib/db/settings';
import { createTestContext, seedAccount } from '@/lib/db/testing';

const WRITER = { deviceId: 'device-a', deviceName: 'Mac · Web' };

describe('snapshot round-trip', () => {
  it('restores the ledger onto a different device and never carries API keys', async () => {
    const source = await createTestContext();

    // Self-referencing FKs are the case a bulk insert gets wrong, so the
    // fixture includes both: a share account pointing at its brokerage, and a
    // transaction pointing at another transaction.
    const cash = await seedAccount(source, { name: 'Cash', type: 'ASSET', balance: 500 });
    const share = await seedAccount(source, {
      name: 'VOO',
      type: 'SHARE',
      ticker: 'VOO',
      brokerage: 'Schwab',
      brokerage_account_id: cash,
      shares: 2,
      cost_basis: 400,
      balance: 450,
    });

    const card = await seedAccount(source, {
      name: 'Amex',
      type: 'LIABILITY',
      balance: -80,
      credit_limit: 1000,
      reward_currency: 'MR',
    });

    const expense = await source.db.query<{ id: string }>(
      `INSERT INTO transactions (user_id, type, amount, currency, from_account, transaction_date)
       VALUES ($1, 'EXPENSE', 25, 'USD', $2, '2026-08-01') RETURNING id`,
      [source.userId, card],
    );
    // REWARD_EARN is the one shape the schema lets carry a self-reference, so
    // it is what exercises the two-pass insert.
    await source.db.query(
      `INSERT INTO transactions
         (user_id, type, amount, reward_currency, to_account, transaction_date, reference_transaction_id)
       VALUES ($1, 'REWARD_EARN', 50, 'MR', $2, '2026-08-01', $3)`,
      [source.userId, card, expense.rows[0]!.id],
    );

    await setSetting(source.db, source.userId, 'fx:HKD', 7.8);
    await setApiKey(source.db, source.userId, 'finnhub', 'secret-key-1234');

    const snapshot = await buildSnapshot(source.db, source.userId, WRITER);

    // The key must not even be present in the payload that would reach Drive.
    expect(JSON.stringify(snapshot)).not.toContain('secret-key-1234');

    // A second device: its own local user id, its own pre-existing API key.
    const target = await createTestContext();
    expect(target.userId).not.toBe(source.userId);
    await setApiKey(target.db, target.userId, 'finnhub', 'target-key-9999');

    await restoreSnapshot(target.db, target.userId, snapshot);

    const accounts = await target.db.query<{ id: string; name: string; user_id: string; brokerage_account_id: string | null }>(
      'SELECT id, name, user_id, brokerage_account_id FROM accounts ORDER BY name',
    );
    expect(accounts.rows.map((row) => row.name)).toEqual(['Amex', 'Cash', 'VOO']);
    // Re-keyed onto the target's local identity, with the self-reference intact.
    expect(accounts.rows.every((row) => row.user_id === target.userId)).toBe(true);
    expect(accounts.rows.find((row) => row.name === 'VOO')!.brokerage_account_id).toBe(cash);

    const linked = await target.db.query<{ reference_transaction_id: string | null }>(
      `SELECT reference_transaction_id FROM transactions WHERE type = 'REWARD_EARN'`,
    );
    expect(linked.rows[0]!.reference_transaction_id).toBe(expense.rows[0]!.id);

    const settings = await target.db.query<{ key: string; value: unknown }>(
      'SELECT key, value FROM local_settings ORDER BY key',
    );
    // Synced setting arrived; the target's own device-local key survived.
    expect(settings.rows.map((row) => row.key)).toEqual(['apikey:finnhub', 'fx:HKD']);
    expect(settings.rows[0]!.value).toBe('target-key-9999');

    // The restored BIGSERIAL must not hand out a number already in use.
    await target.db.query(
      `INSERT INTO transactions (user_id, type, amount, currency, from_account, transaction_date)
       VALUES ($1, 'EXPENSE', 5, 'USD', $2, '2026-08-03')`,
      [target.userId, card],
    );
    const seqs = await target.db.query<{ seq: number }>('SELECT seq FROM transactions');
    expect(new Set(seqs.rows.map((row) => row.seq)).size).toBe(3);
  });
});
