import { describe, expect, it } from 'vitest';

import { buildSnapshot, restoreSnapshot } from '@/lib/db/backup';
import { createMemoryDb } from '@/lib/db/client';
import { setApiKey } from '@/lib/db/settings';
import { seedAccount } from '@/lib/db/testing';

const WRITER = { deviceId: 'device-a', deviceName: 'Mac · Web' };

describe('snapshot round-trip', () => {
  it('restores the ledger onto a different device and never carries API keys', async () => {
    // Two separate databases: the whole point is a different device.
    const source = { db: await createMemoryDb() };

    // Self-referencing FKs are the case a bulk insert gets wrong, so the
    // fixture includes both: a share position pointing at its brokerage, and a
    // transaction pointing at another transaction.
    const cash = await seedAccount(source, { name: 'Cash', type: 'ASSET', balance: 500 });
    await seedAccount(source, {
      name: 'VOO',
      type: 'SHARE',
      ticker: 'VOO',
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
      `INSERT INTO transactions (type, amount, currency, from_account, transaction_date)
       VALUES ('EXPENSE', 25, 'USD', $1, '2026-08-01') RETURNING id`,
      [card],
    );
    await source.db.query(
      `INSERT INTO transactions
         (type, amount, reward_currency, to_account, transaction_date, reference_transaction_id)
       VALUES ('REWARD_EARN', 50, 'MR', $1, '2026-08-01', $2)`,
      [card, expense.rows[0]!.id],
    );

    await setApiKey(source.db, 'finnhub', 'secret-key-1234');
    await source.db.query("INSERT INTO device_ai_settings VALUES (1, $1::jsonb)", [JSON.stringify({ backend: 'local', local: { kind: 'folder', modelId: 'private-source-model', label: 'Private folder' } })]);

    const snapshot = await buildSnapshot(source.db, WRITER);

    // The key must not even be present in the payload that would reach Drive.
    expect(JSON.stringify(snapshot)).not.toContain('secret-key-1234');
    expect(JSON.stringify(snapshot)).not.toContain('private-source-model');

    // A second device with its own pre-existing API key.
    const target = { db: await createMemoryDb() };
    await setApiKey(target.db, 'finnhub', 'target-key-9999');
    const ownAi = { backend: 'remote', local: null };
    await target.db.query("INSERT INTO device_ai_settings VALUES (1, $1::jsonb)", [JSON.stringify(ownAi)]);

    await restoreSnapshot(target.db, snapshot);

    const accounts = await target.db.query<{ name: string; brokerage_account_id: string | null }>(
      'SELECT name, brokerage_account_id FROM accounts_flat ORDER BY name',
    );
    expect(accounts.rows.map((row) => row.name)).toEqual(['Amex', 'Cash', 'VOO']);
    expect(accounts.rows.find((row) => row.name === 'VOO')!.brokerage_account_id).toBe(cash);

    const linked = await target.db.query<{ reference_transaction_id: string | null }>(
      `SELECT reference_transaction_id FROM transactions WHERE type = 'REWARD_EARN'`,
    );
    expect(linked.rows[0]!.reference_transaction_id).toBe(expense.rows[0]!.id);

    // The target's own device-local key survived the restore.
    const secrets = await target.db.query<{ api_key: string }>('SELECT api_key FROM device_secrets');
    expect(secrets.rows).toEqual([{ api_key: 'target-key-9999' }]);
    expect((await target.db.query<{ config: unknown }>('SELECT config FROM device_ai_settings')).rows).toEqual([{ config: ownAi }]);

    // The restored identity column must not hand out a number already in use.
    await target.db.query(
      `INSERT INTO transactions (type, amount, currency, from_account, transaction_date)
       VALUES ('EXPENSE', 5, 'USD', $1, '2026-08-03')`,
      [card],
    );
    const seqs = await target.db.query<{ seq: number }>('SELECT seq FROM transactions');
    expect(new Set(seqs.rows.map((row) => row.seq)).size).toBe(3);
  });
});
