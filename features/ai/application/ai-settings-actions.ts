import { AiSettingsSchema, type AiSettings } from '@/features/ai/config';
import { getSessionContext } from '@/lib/db/session';
import { maybeOne } from '@/lib/db/sql';

export async function getAiSettings(): Promise<AiSettings> {
  const { db } = await getSessionContext();
  const row = await maybeOne<{ config: unknown }>(db, 'SELECT config FROM device_ai_settings WHERE id = 1');
  return AiSettingsSchema.parse(row?.config ?? { backend: 'remote', local: null });
}

/** Device-local configuration, excluded from ledger snapshots, just like API keys. */
export async function saveAiSettings(input: AiSettings): Promise<void> {
  const config = AiSettingsSchema.parse(input);
  const { db } = await getSessionContext();
  await db.query(
    `INSERT INTO device_ai_settings (id, config) VALUES (1, $1::jsonb)
     ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config`,
    [JSON.stringify(config)],
  );
}
