import { readFile } from 'node:fs/promises';
const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) throw Error('Usage: node features/ai/eval/compare.mjs before.json after.json');
const before = JSON.parse(await readFile(beforePath, 'utf8')), after = JSON.parse(await readFile(afterPath, 'utf8'));
const results = report => report.runs.flatMap(run => run.results);
for (const report of [before, after]) {
  if (report.mode !== 'ledger' || report.fatal || report.runs.some(run => run.fatal || !run.done) || report.consoleErrors.length) throw Error('Compare completed ledger runs without infrastructure failures.');
}
if (before.version !== after.version || JSON.stringify(before.gpu) !== JSON.stringify(after.gpu) || JSON.stringify(before.runs.map(run => run.model)) !== JSON.stringify(after.runs.map(run => run.model))) throw Error('Use the same browser version, GPU, model and repeat count.');
const baseline = results(before), candidate = results(after);
if ([...baseline,...candidate].some(row=>typeof row.planPassed!=='boolean')) throw Error('Legacy ledger-only metrics cannot be compared as exact-plan accuracy.');
if (JSON.stringify(baseline.map(r => [r.id, r.text, r.expected])) !== JSON.stringify(candidate.map(r => [r.id, r.text, r.expected]))) throw Error('Fixture selection, order and expectations must match.');
function summarize(rows) {
  const sum = key => rows.reduce((total, row) => total + row.measurements[key], 0);
  const nullableSum = key => rows.every(row => row.measurements[key] !== null) ? sum(key) : null;
  const times = rows.map(row => row.ms).sort((a,b) => a-b);
  return { cases: rows.length, plansPassed: rows.filter(row => row.planPassed).length, ledgersPassed: rows.filter(row => row.ledgerPassed).length, passed: rows.filter(row => row.passed).length, calls: sum('calls'),
    instructionChars: sum('instructionChars'), inputChars: sum('inputChars'),
    inputTokens: nullableSum('inputTokens'), outputTokens: nullableSum('outputTokens'),
    p50Ms: times[Math.floor(times.length * .5)], p95Ms: times[Math.ceil(times.length * .95) - 1] };
}
const a = summarize(baseline), b = summarize(candidate);
const reduction = key => a[key] ? Math.round((a[key] - b[key]) / a[key] * 1000) / 10 : null;
const report = { before: beforePath, after: afterPath, version: after.version, beforeSources: before.sources, afterSources: after.sources,
  baseline: a, candidate: b, reductionPercent: Object.fromEntries(['calls', 'instructionChars', 'inputChars', 'inputTokens', 'outputTokens', 'p50Ms', 'p95Ms'].map(key => [key, reduction(key)])),
  cases: candidate.map((row, index) => ({ id: row.id, baselinePassed: baseline[index].passed, candidatePassed: row.passed, baselinePlan: baseline[index].planPassed, candidatePlan: row.planPassed, baselineLedger: baseline[index].ledgerPassed, candidateLedger: row.ledgerPassed,
    before: baseline[index].measurements, after: row.measurements, beforeMs: baseline[index].ms, afterMs: row.ms, context: row.mlp })),
  notes: ['Latency includes host checks and expected refusal/cancellation cases; model load is excluded.', 'Missing token usage is null; character counts are not token estimates.', 'Fixed regression fixtures do not establish general natural-language accuracy.'] };
console.log(JSON.stringify(report, null, 2));
if (candidate.some(row => !row.passed)) process.exitCode = 1;
