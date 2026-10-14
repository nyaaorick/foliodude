import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeReport } from './report-utils.mjs';
const root = fileURLToPath(new URL('../../..', import.meta.url)), args = process.argv.slice(2);
const take = name => { const i = args.indexOf(name); if (i < 0)
    return undefined; const value = args[i + 1]; args.splice(i, 2); return value; };
const verificationFile = take('--verification'), output = take('--output');
const baseline = args.includes('--baseline');
const reports = baseline ? JSON.parse(await readFile(new URL('./fixtures/baseline.json', import.meta.url), 'utf8')).reports
    : await Promise.all(args.map(async (f) => JSON.parse(await readFile(f, 'utf8'))));
if (reports.length !== 4)
    throw Error('ai:results -- --baseline | EDGE_REG FIREFOX_REG EDGE_HOLDOUT FIREFOX_HOLDOUT [--verification JSON] [--output MD]');
const rows = reports.map((r, i) => {
    const expectedBrowser = i % 2 ? 'firefox' : 'edge', expectedSuite = i < 2 ? 'regression' : 'holdout', expectedRuns = i < 2 ? 3 : 1;
    const graded = summarizeReport(r);
    if (r.browser !== expectedBrowser || r.suite !== expectedSuite || r.mode !== 'ledger' || r.runs.length !== expectedRuns || !graded.acceptance.coverageComplete || !graded.acceptance.infrastructurePassed)
        throw Error('Use four complete, compatible, full-coverage evaluations.');
    if (r.evaluationSeed !== reports[0].evaluationSeed || JSON.stringify(r.runs[0].model) !== JSON.stringify(reports[0].runs[0].model))
        throw Error('Model or fixture seed changed.');
    for (const [file, hash] of Object.entries(reports[0].sources))
        if (!file.endsWith('/run.mjs') && r.sources[file] !== hash)
            throw Error(`Source changed across suites: ${file}`);
    return { browser: r.browser, suite: r.suite, ...graded, artifactErrors: r.artifactErrors ?? [], provenance: r.provenance ?? null };
});
const verification = verificationFile ? JSON.parse(await readFile(verificationFile, 'utf8')) : null;
const md = ['# AI evaluation report', '', baseline ? 'Frozen historical baseline; this is not a new model run.' : 'Complete local-model evaluation.', '', rows.some(x => !x.acceptance.passed) ? '**Accuracy gates failed. Keep Experimental.**' : 'Finite acceptance gates passed.', ''];
if (verification) {
    md.push(`Application verification: ${verification.passed ? 'PASS' : 'FAIL'}, ${verification.tests?.passed ?? 'unknown'}/${verification.tests?.total ?? 'unknown'} tests.`, '', '| Check | Exit |', '|---|---|');
    for (const step of verification.steps)
        md.push(`| ${step.name} | ${step.exitCode} |`);
}
md.push('', '| Browser | Suite | Plans | Ledger outcomes | Preparation writes | Forbidden proposals | Executable no-action drafts | Calls | p50/p95 ms | Gate |', '|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
    const s = r.summary;
    md.push(`| ${r.browser} | ${r.suite} | ${s.plansPassed}/${s.cases} | ${s.ledgersPassed}/${s.cases} | ${s.preparationWrites} | ${s.forbiddenDrafts} | ${s.executableNegativeDrafts} | ${s.calls} | ${s.p50Ms?.toFixed(1)} / ${s.p95Ms?.toFixed(1)} | ${r.acceptance.passed ? 'PASS' : 'FAIL'} |`);
}
md.push('', 'Regression gate: 95%, every critical case, three full repetitions. Holdout gate: 90%, no executable negative/hypothetical draft. Validation-blocked no-action proposals also fail the stricter gate. Wrong plans remain failures even when no write occurs. Optional screenshots are not accuracy evidence. Ledger scores include the consequences of wrong plans and are not conditional executor reliability.', '', 'Timings are observations; model load/warmup is excluded. Fixed-output UI tests are separate from model accuracy. Operational-plan scoring excludes unrequested optional prose/category/date; cancellation is a host-contract fixture.', '', '## Failure details', '');
for (const [i, r] of rows.entries()) {
    md.push(`### ${r.browser}/${r.suite}`, '', `Failure labels: ${JSON.stringify(r.summary.failures)}. Artifact errors: ${r.artifactErrors.length}.`, '', '| Run | Case | Input | Failure |', '|---|---|---|---|');
    for (const [index, run] of reports[i].runs.entries())
        for (const x of run.results)
            if (!x.passed)
                md.push(`| ${index + 1} | ${x.id} | ${x.text.replaceAll('|', '\\|').replaceAll('\n', ' ')} | ${x.failureKind ?? ''} |`);
}
const file = output ?? path.join(root, '.artifacts/ai', `evaluation-${new Date().toISOString().replaceAll(':', '-')}.md`);
await mkdir(path.dirname(file), { recursive: true });
if (!file.endsWith('.md')) throw Error('Choose a new Markdown output path.');
await writeFile(file, md.join('\n') + '\n', { flag: 'wx' });
await writeFile(file.replace(/\.md$/, '') + '.json', JSON.stringify({ baseline, verification, experimental: rows.some(x => !x.acceptance.passed), evaluations: rows }, null, 2), { flag: 'wx' });
console.log(`Report: ${file}`);
if (rows.some(x => !x.acceptance.passed) || verification?.passed === false)
    process.exitCode = 1;
