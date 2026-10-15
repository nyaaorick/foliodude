import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../..', import.meta.url));
if (!process.argv.includes('--full')) {
    console.log('ai:eval -- --full: sequential Edge/Firefox regression x3 and holdout x1. Keep the Mac awake and lid open; no prompt tuning. Use harness:ai for individual/diagnostic cases.');
    process.exit(0);
}
const stamp = new Date().toISOString().replaceAll(':', '-'), directory = path.join(root, '.artifacts/ai');
await mkdir(directory, { recursive: true });
const batch = { runs: [] };
evaluation: for (const suite of ['regression', 'holdout'])
    for (const browser of ['edge', 'firefox']) {
        console.log(`${browser}/${suite}`);
        let stdout = '';
        const exitCode = await new Promise((resolve, reject) => { const p = spawn(process.execPath, ['features/ai/eval/run.mjs', '--browser', browser, '--suite', suite, '--seed', '20261012', '--repeat', suite === 'regression' ? '3' : '1'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] }); p.stdout.on('data', chunk => { stdout += chunk; process.stdout.write(chunk); }); p.once('error', reject); p.once('close', resolve); });
        const file = stdout.trim().split('\n').findLast(x => x.startsWith('Report: '))?.slice(8);
        const report = file ? JSON.parse(await readFile(file, 'utf8')) : null;
        batch.runs.push({ browser, suite, exitCode, file, summary: report?.summary, acceptance: report?.acceptance, fatal: report?.fatal });
        if (!report || report.fatal) {
            batch.interrupted = true;
            break evaluation;
        }
    }
batch.passed = batch.runs.length === 4 && batch.runs.every(x => x.exitCode === 0 && x.acceptance?.passed);
if (!batch.passed)
    process.exitCode = 1;
const file = path.join(directory, `${stamp}-batch.json`);
await writeFile(file, JSON.stringify(batch, null, 2));
console.log(`Batch: ${file}`);
