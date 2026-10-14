import { describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
const { generate } = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('@/features/ai/providers/text-client', () => ({ generateAiText: generate }));
import { prepareMlp } from '../protocol/mlp';
import { HARNESS_CASES } from '../eval/cases';
import { holdoutCases } from '../eval/holdout-cases';
import { expectedPlan } from '../eval/expected-plans';

describe('frozen protocol evidence', () => {
  it('rejects observed malformed outputs without repair and preserves both fixture inventories', async () => {
    const corpus = JSON.parse(await readFile(new URL('../eval/fixtures/observed-format.json', import.meta.url), 'utf8'));
    for (const fixture of corpus) {
      generate.mockResolvedValueOnce(fixture.raw);
      await expect(prepareMlp(fixture.text, fixture.accounts.map((a: object, i: number) => ({ ...a, id: `account-${i}` }))))
        .rejects.toMatchObject({ stage: fixture.expectedStage, output: fixture.raw });
    }
    expect(generate).toHaveBeenCalledTimes(corpus.length);
    const manifest = JSON.parse(await readFile(new URL('../eval/fixtures/manifest.json', import.meta.url), 'utf8'));
    expect(HARNESS_CASES.map(x => x.id)).toEqual(manifest.regressionIds);
    const heldout = holdoutCases();
    expect(heldout.map(x => x.id)).toEqual(manifest.holdoutIds);
    expect(heldout.filter(x => x.id.startsWith('holdout-en-'))).toHaveLength(50);
    expect(heldout.filter(x => x.id.startsWith('holdout-zh-'))).toHaveLength(50);
    for (const fixture of [...HARNESS_CASES, ...heldout]) expect(Array.isArray(expectedPlan(fixture))).toBe(true);
  });
});
