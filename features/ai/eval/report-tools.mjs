import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { summarizeReport, assertSameEvaluation, retainRuns } from './report-utils.mjs';
const args = process.argv.slice(2), command = args.shift();
const flag = name => { const i = args.indexOf(name); if (i < 0)
    return undefined; const value = args[i + 1]; if (!value)
    throw Error(`Missing ${name}`); args.splice(i, 2); return value; };
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
