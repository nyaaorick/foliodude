import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { summarizeReport, assertSameEvaluation, assertComparableReports, retainRuns } from './report-utils.mjs';
const root = fileURLToPath(new URL('../../..', import.meta.url));
async function manage(args) {
    const command = args.shift();
    const flag = name => {
        const i = args.indexOf(name);
        if (i < 0)
            return undefined;
        const value = args[i + 1];
        if (!value)
            throw Error(`Missing ${name}`);
        args.splice(i, 2);
        return value;
    };
    const output = flag('--output'), selected = flag('--runs'), selection = flag('--select');
    if (!['summary', 'retain', 'merge'].includes(command) || !args.length)
        throw Error('ai:report -- summary REPORT | retain REPORT --runs 1,2 --output NEW | merge REPORTS --output NEW');
    const reports = await Promise.all(args.map(async (file) => selectReport(JSON.parse(await readFile(file, 'utf8')))));
    function selectReport(value) {
        if (!value.reports)
            return value;
        const found = value.reports.find(r => `${r.browser}/${r.suite}` === selection);
        if (!found)
            throw Error('For the frozen baseline use --select edge/regression, firefox/regression, edge/holdout or firefox/holdout.');
        return found;
    }
    let report;
    if (command === 'summary') {
        if (reports.length !== 1)
            throw Error('Choose one report.');
        report = { ...reports[0], ...summarizeReport(reports[0]) };
    }
    else if (command === 'retain') {
        if (reports.length !== 1 || !selected)
            throw Error('Choose whole repetitions with --runs.');
        for (const [file, hash] of Object.entries(reports[0].sources))
            if (createHash('sha256').update(await readFile(file)).digest('hex') !== hash)
                throw Error(`Source changed: ${file}. Do not certify this report against changed sources.`);
        report = retainRuns(reports[0], selected.split(',').map(x => Number(x) - 1));
    }
    else {
        const first = reports[0];
        for (const r of reports) {
            assertSameEvaluation(first, r);
            if (r.fatal || r.consoleErrors?.length || !summarizeReport(r).acceptance.coverageComplete)
                throw Error('Merge only complete evaluations.');
            for (const [file, hash] of Object.entries(first.sources))
                if (!file.endsWith('/run.mjs') && r.sources[file] !== hash)
                    throw Error(`Sources differ: ${file}`);
        }
        report = { ...first, runs: reports.flatMap(r => r.runs), artifactErrors: reports.flatMap(r => r.artifactErrors ?? []), provenance: { mergedFrom: args, wholeRepetitionsOnly: true } };
        Object.assign(report, summarizeReport(report));
    }
    if (output) {
        if (args.some(file => path.resolve(file) === path.resolve(output)))
            throw Error('Preserve original reports; choose a new output path.');
        await mkdir(path.dirname(output), { recursive: true });
        await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    }
    console.log(JSON.stringify({ summary: report.summary, acceptance: report.acceptance, output }, null, 2));
    if (!report.acceptance.passed)
        process.exitCode = 1;
}
/** Reports from the runner record both; only the frozen baseline predates them and it ran 0.1.3 plain text.
 * Calls without a response (cancellation fixture) have no applied mode and are excluded from the label. */
const runtimeLabel = r => {
    if (!r.packageVersions) return 'everything-webgpu 0.1.3 (frozen), text (unconstrained)';
    const modes = new Set(r.runs.flatMap(run => run.results.flatMap(x => x.measurements.responses.filter(call => call.status !== null).map(call => call.outputMode))));
    return `everything-webgpu ${r.packageVersions['everything-webgpu']}, ${[...modes].join('+') || 'output mode unrecorded'}`;
};
async function diagnose(files) {
    const reports = files.length ? await Promise.all(files.map(async (f) => JSON.parse(await readFile(f, 'utf8'))))
        : JSON.parse(await readFile(new URL('./fixtures/baseline.json', import.meta.url), 'utf8')).reports;
    const buckets = {}, examples = {};
    function classify(x) {
        if (x.failureKind === 'format' && x.error?.includes('stopped before'))
            return 'format/truncated-output';
        if (x.failureKind === 'format' && x.error?.startsWith('Generated '))
            return 'format/decoder-rejected';
        // Decoded JSON satisfied the native schema but broke a bound it cannot express (e.g. positive amounts).
        if (x.failureKind === 'format' && x.error?.startsWith('[') && /"code": "(too_small|too_big|invalid_format)"/.test(x.error))
            return 'format/constraint-outside-decoder-subset';
        if (x.failureKind === 'format') {
            let parsed;
            const text = (typeof x.modelOutput === 'string' ? x.modelOutput : '').replace(/^\s*<think>\s*<\/think>\s*/, '').trim();
            const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(text);
            try {
                parsed = JSON.parse(fenced ? fenced[1] : text);
            }
            catch {
                return 'format/invalid-json-or-extra-text';
            }
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'steps' in parsed && 'clarification' in parsed)
                return 'format/combined-envelopes';
            if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || !('steps' in parsed || 'clarification' in parsed))
                return 'format/wrong-envelope';
            return 'format/schema-fields';
        }
        if (x.error?.includes('aborted'))
            return 'runtime/aborted-request';
        if (x.failureKind === 'database')
            return 'database/unexpected-save-failure';
        if (x.expected.outcome === 'no_action' && x.saveMs > 0)
            return 'semantic/executable-no-action-request';
        if (x.expected.outcome === 'no_action' && x.extracted?.length)
            return 'semantic/blocked-no-action-proposal';
        if (x.expected.outcome === 'no_action')
            return 'semantic/no-action-response';
        if (x.expected.outcome === 'clarification')
            return 'semantic/missing-clarification';
        if (x.error?.includes('name must remain verbatim'))
            return 'semantic/ungrounded-name';
        if (x.error?.includes('amount was not provided'))
            return 'semantic/ungrounded-amount';
        if (!x.extracted?.length)
            return 'semantic/empty-or-unavailable-plan';
        if (x.extracted.length !== x.expectedPlan?.length)
            return 'semantic/step-count';
        if (x.extracted.some((a, i) => a.action !== x.expectedPlan[i].action))
            return 'semantic/action-order';
        return 'semantic/parameters-or-response';
    }
    const summary = { evidence: 'Observed output categories, not experimentally proven model root causes.', reports: reports.map(r => ({ browser: r.browser, suite: r.suite, ...summarizeReport(r) })) };
    for (const r of reports)
        for (const [index, run] of r.runs.entries())
            for (const x of run.results)
                if (!x.passed) {
                    const kind = classify(x);
                    buckets[kind] = (buckets[kind] ?? 0) + 1;
                    if (!examples[kind])
                        examples[kind] = { browser: r.browser, suite: r.suite, run: index + 1, id: x.id, text: x.text, raw: x.modelOutput ?? null, normalizedActions: x.extracted, expectedPlan: x.expectedPlan, error: x.error ?? null, before: x.before, after: x.after };
                }
    summary.categories = buckets;
    summary.examples = examples;
    const directory = path.join(root, '.artifacts/ai');
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, `diagnosis-${new Date().toISOString().replaceAll(':', '-')}.json`);
    await writeFile(file, JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ file, categories: buckets, reports: summary.reports.map(x => ({ browser: x.browser, suite: x.suite, summary: x.summary })) }, null, 2));
}
async function results(args) {
    const take = name => {
        const i = args.indexOf(name);
        if (i < 0)
            return undefined;
        const value = args[i + 1];
        args.splice(i, 2);
        return value;
    };
    const verificationFile = take('--verification'), output = take('--output');
    const baseline = args.includes('--baseline');
    const reports = baseline ? JSON.parse(await readFile(new URL('./fixtures/baseline.json', import.meta.url), 'utf8')).reports
        : await Promise.all(args.map(async (f) => JSON.parse(await readFile(f, 'utf8'))));
    if (reports.length !== 4)
        throw Error('ai:report -- results --baseline | EDGE_REG FIREFOX_REG EDGE_HOLDOUT FIREFOX_HOLDOUT [--verification JSON] [--output MD]');
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
        return { browser: r.browser, suite: r.suite, runtime: runtimeLabel(r), ...graded, artifactErrors: r.artifactErrors ?? [], provenance: r.provenance ?? null };
    });
    const verification = verificationFile ? JSON.parse(await readFile(verificationFile, 'utf8')) : null;
    const md = ['# AI evaluation report', '', baseline ? 'Frozen historical baseline; this is not a new model run.' : 'Complete local-model evaluation.', '', rows.some(x => !x.acceptance.passed) ? '**Accuracy gates failed. Keep Experimental.**' : 'Finite acceptance gates passed.', ''];
    if (verification) {
        md.push(`Application verification: ${verification.passed ? 'PASS' : 'FAIL'}, ${verification.tests?.passed ?? 'unknown'}/${verification.tests?.total ?? 'unknown'} tests.`, '', '| Check | Exit |', '|---|---|');
        for (const step of verification.steps)
            md.push(`| ${step.name} | ${step.exitCode} |`);
    }
    md.push('', '| Browser | Suite | Runtime/output | Plans | Ledger outcomes | Format / semantic / validation / database failures | Preparation writes | Forbidden proposals | Executable no-action drafts | Calls | p50/p95 ms | Gate |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of rows) {
        const s = r.summary;
        md.push(`| ${r.browser} | ${r.suite} | ${r.runtime} | ${s.plansPassed}/${s.cases} | ${s.ledgersPassed}/${s.cases} | ${s.failures.format} / ${s.failures.semantic} / ${s.failures.validation} / ${s.failures.database} | ${s.preparationWrites} | ${s.forbiddenDrafts} | ${s.executableNegativeDrafts} | ${s.calls} | ${s.p50Ms?.toFixed(1)} / ${s.p95Ms?.toFixed(1)} | ${r.acceptance.passed ? 'PASS' : 'FAIL'} |`);
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
    if (!file.endsWith('.md'))
        throw Error('Choose a new Markdown output path.');
    await writeFile(file, md.join('\n') + '\n', { flag: 'wx' });
    await writeFile(file.replace(/\.md$/, '') + '.json', JSON.stringify({ baseline, verification, experimental: rows.some(x => !x.acceptance.passed), evaluations: rows }, null, 2), { flag: 'wx' });
    console.log(`Report: ${file}`);
    if (rows.some(x => !x.acceptance.passed) || verification?.passed === false)
        process.exitCode = 1;
}
async function compare(args) {
    const [beforePath, afterPath] = args;
    if (!beforePath || !afterPath)
        throw Error('Usage: npm run ai:report -- compare before.json after.json');
    const before = JSON.parse(await readFile(beforePath, 'utf8')), after = JSON.parse(await readFile(afterPath, 'utf8'));
    assertComparableReports(before, after);
    const baseline = before.runs.flatMap(run => run.results), candidate = after.runs.flatMap(run => run.results);
    function metrics(report) {
        const rows = report.runs.flatMap(run => run.results);
        const sum = key => rows.reduce((total, row) => total + row.measurements[key], 0);
        const nullableSum = key => rows.every(row => row.measurements[key] !== null) ? sum(key) : null;
        const { cases, plansPassed, ledgersPassed, passed, calls, p50Ms, p95Ms } = summarizeReport(report).summary;
        return { cases, plansPassed, ledgersPassed, passed, calls, p50Ms, p95Ms,
            instructionChars: sum('instructionChars'), inputChars: sum('inputChars'),
            inputTokens: nullableSum('inputTokens'), outputTokens: nullableSum('outputTokens') };
    }
    const a = metrics(before), b = metrics(after);
    const reduction = key => a[key] ? Math.round((a[key] - b[key]) / a[key] * 1000) / 10 : null;
    const report = { before: beforePath, after: afterPath, version: after.version, runtime: { before: runtimeLabel(before), after: runtimeLabel(after) }, beforeSources: before.sources, afterSources: after.sources,
        baseline: a, candidate: b, reductionPercent: Object.fromEntries(['calls', 'instructionChars', 'inputChars', 'inputTokens', 'outputTokens', 'p50Ms', 'p95Ms'].map(key => [key, reduction(key)])),
        cases: candidate.map((row, index) => ({ id: row.id, baselinePassed: baseline[index].passed, candidatePassed: row.passed, baselinePlan: baseline[index].planPassed, candidatePlan: row.planPassed, baselineLedger: baseline[index].ledgerPassed, candidateLedger: row.ledgerPassed,
            before: baseline[index].measurements, after: row.measurements, beforeMs: baseline[index].ms, afterMs: row.ms, context: row.mlp })),
        notes: ['Latency includes host checks and expected refusal/cancellation cases; model load is excluded.', 'Missing token usage is null; character counts are not token estimates.', 'Fixed regression fixtures do not establish general natural-language accuracy.'] };
    console.log(JSON.stringify(report, null, 2));
    if (candidate.some(row => !row.passed))
        process.exitCode = 1;
}
const args = process.argv.slice(2), command = args.shift();
if (!command || command === '--help') {
    console.log('ai:report -- summary REPORT [--select browser/suite] [--output NEW]\n  retain REPORT --runs 1,2 --output NEW\n  merge REPORTS... --output NEW\n  diagnose [REPORTS...]\n  results --baseline | EDGE_REG FIREFOX_REG EDGE_HOLDOUT FIREFOX_HOLDOUT [--verification JSON] [--output NEW.md]\n  compare BEFORE AFTER');
}
else
    switch (command) {
        case 'summary':
        case 'retain':
        case 'merge':
            await manage([command, ...args]);
            break;
        case 'diagnose':
            await diagnose(args);
            break;
        case 'results':
            await results(args);
            break;
        case 'compare':
            await compare(args);
            break;
        default: throw Error('ai:report -- summary|retain|merge|diagnose|results|compare ...');
    }
