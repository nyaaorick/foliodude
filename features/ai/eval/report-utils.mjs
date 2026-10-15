import { readFile } from 'node:fs/promises';
export const manifest = JSON.parse(await readFile(new URL('./fixtures/manifest.json', import.meta.url), 'utf8'));
export const SCORING_VERSION = 2;
/** Grade complete ordered fixture coverage, never a successful subset. */
export function summarizeReport(report) {
    const results = report.runs.flatMap(run => run.results);
    if (results.some(x => typeof x.planPassed !== 'boolean'))
        throw Error('This report predates exact-plan scoring; do not compare it as plan accuracy.');
    const ids = report.suite === 'holdout' ? manifest.holdoutIds : manifest.regressionIds;
    const coverageComplete = report.runs.length > 0 && report.runs.every(run => run.done && !run.fatal && JSON.stringify(run.results.map(x => x.id)) === JSON.stringify(ids));
    const times = results.map(x => x.ms).sort((a, b) => a - b);
    const percentile = p => times[Math.min(times.length - 1, Math.ceil(times.length * p) - 1)] ?? null;
    const summary = {
        cases: results.length, passed: results.filter(x => x.passed === true).length, failed: results.filter(x => x.passed === false).length,
        plansPassed: results.filter(x => x.planPassed).length, ledgersPassed: results.filter(x => x.ledgerPassed).length,
        preparationWrites: results.filter(x => !x.previewUnchanged).length,
        forbiddenDrafts: results.filter(x => x.expected.outcome === 'no_action' && x.extracted?.length).length,
        executableNegativeDrafts: results.filter(x => x.expected.outcome === 'no_action' && x.saveMs > 0).length,
        failures: Object.fromEntries(['format', 'semantic', 'validation', 'database'].map(kind => [kind, results.filter(x => !x.passed && x.failureKind === kind).length])),
        calls: results.reduce((sum, x) => sum + x.measurements.calls, 0), structured: results.filter(x => x.structured === true).length,
        p50Ms: times[Math.floor(times.length * .5)] ?? null, p95Ms: percentile(.95),
    };
    const infrastructurePassed = !report.fatal && !(report.consoleErrors?.length) && report.runs.every(run => run.done && !run.fatal);
    const configurationConsistent = report.runs.every(run => JSON.stringify(run.model) === JSON.stringify(report.runs[0]?.model));
    const acceptance = {
        threshold: report.suite === 'holdout' ? .90 : .95, accuracy: results.length ? summary.plansPassed / results.length : 0,
        coverageComplete, infrastructurePassed, configurationConsistent, criticalPassed: results.filter(x => manifest.criticalIds.includes(x.id)).every(x => x.planPassed),
        preparationWrites: summary.preparationWrites,
        saveCorrect: report.mode !== 'ledger' || results.filter(x => x.planPassed).every(x => x.ledgerPassed === true),
        repetitionRequirementMet: report.runs.length >= (report.suite === 'holdout' ? 1 : 3),
    };
    acceptance.passed = coverageComplete && infrastructurePassed && configurationConsistent && acceptance.repetitionRequirementMet && acceptance.accuracy >= acceptance.threshold && acceptance.criticalPassed && acceptance.saveCorrect && !summary.preparationWrites;
    return { scoringVersion: report.scoringVersion ?? SCORING_VERSION, acceptanceVersion: SCORING_VERSION, summary, acceptance };
}
export function assertSameEvaluation(a, b) {
    for (const key of ['browser', 'version', 'gpu', 'evaluationSeed', 'mode', 'suite', 'folder'])
        if (JSON.stringify(a[key]) !== JSON.stringify(b[key]))
            throw Error(`Configuration differs: ${key}`);
    if (JSON.stringify(a.runs[0]?.model) !== JSON.stringify(b.runs[0]?.model))
        throw Error('Model differs.');
    if (a.scoringVersion !== b.scoringVersion)
        throw Error('Scoring versions differ.');
    const fixtures = r => r.runs[0].results.map(({ id, text, expected, expectedPlan }) => ({ id, text, expected, expectedPlan }));
    if (JSON.stringify(fixtures(a)) !== JSON.stringify(fixtures(b)))
        throw Error('Fixtures or expectations differ.');
}
/** Select entire completed repetitions explicitly; preserve excluded-run provenance. */
export function retainRuns(report, indexes) {
    if (!indexes.length || new Set(indexes).size !== indexes.length)
        throw Error('Choose unique whole repetitions.');
    if (report.consoleErrors?.length)
        throw Error('Console errors cannot be silently removed.');
    const selected = indexes.map(index => {
        const run = report.runs[index];
        if (!run?.done || run.fatal)
            throw Error('Cannot retain an incomplete repetition.');
        return run;
    });
    const clean = structuredClone(report);
    clean.provenance = { ...clean.provenance, originalFatal: report.fatal ?? null, retainedRuns: indexes.map(x => x + 1), excludedRuns: report.runs.map((_, i) => i + 1).filter(i => !indexes.includes(i - 1)) };
    clean.runs = structuredClone(selected);
    delete clean.fatal;
    if (report.fatal?.includes('browsingContext.captureScreenshot'))
        clean.artifactErrors = [...(clean.artifactErrors ?? []), { stage: 'post-evaluation screenshot', error: report.fatal }];
    else if (report.fatal && indexes.length === report.runs.length)
        throw Error('Only a post-evaluation screenshot error may be recovered without excluding an interrupted run.');
    Object.assign(clean, summarizeReport(clean));
    if (!clean.acceptance.coverageComplete)
        throw Error('Retained repetitions lack complete fixture coverage.');
    return clean;
}

/** Comparisons may change production sources, but never fixtures or scoring semantics. */
export function assertComparableReports(before, after) {
    assertSameEvaluation(before, after);
    if (before.runs.length !== after.runs.length) throw Error('Repeat counts differ.');
    for (const report of [before, after]) {
        const grade = summarizeReport(report);
        if (report.mode !== 'ledger' || !grade.acceptance.infrastructurePassed)
            throw Error('Compare completed ledger runs without infrastructure failures.');
    }
    const fixtures = r => r.runs.flatMap(run => run.results).map(({ id, text, expected, expectedPlan }) => ({ id, text, expected, expectedPlan }));
    if (JSON.stringify(fixtures(before)) !== JSON.stringify(fixtures(after))) throw Error('Fixture selection, order and expectations must match.');
}

/** Full runs honor accuracy gates; diagnostic subsets require every selected case. */
export function evaluationPassed(report, diagnostic = false) {
    const grade = summarizeReport(report);
    return diagnostic
        ? grade.acceptance.infrastructurePassed && grade.summary.cases > 0 && grade.summary.failed === 0
        : grade.acceptance.passed;
}
