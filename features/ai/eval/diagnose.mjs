import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeReport } from './report-utils.mjs';
const root = fileURLToPath(new URL('../../..', import.meta.url));
const files = process.argv.slice(2);
const reports = files.length ? await Promise.all(files.map(async (f) => JSON.parse(await readFile(f, 'utf8'))))
    : JSON.parse(await readFile(new URL('./fixtures/baseline.json', import.meta.url), 'utf8')).reports;
const buckets = {}, examples = {};
function classify(x) {
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
await writeFile(file, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ file, categories: buckets, reports: summary.reports.map(x => ({ browser: x.browser, suite: x.suite, summary: x.summary })) }, null, 2));
