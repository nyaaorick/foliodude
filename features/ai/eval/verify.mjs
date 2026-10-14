import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../..', import.meta.url)), directory = path.join(root, '.artifacts/ai');
await mkdir(directory, { recursive: true });
const stamp = new Date().toISOString().replaceAll(':', '-');
const report = { mode: 'Deterministic application verification; fixed Responses UI outputs. No model-accuracy claim.', steps: [] };
const repeats = Number(process.argv[process.argv.indexOf('--ui-repeat') + 1] ?? 1);
const repeat = process.argv.includes('--ui-repeat') ? repeats : 1;
if (!Number.isInteger(repeat) || repeat < 1)
    throw Error('Invalid --ui-repeat');
async function run(name, cmd, args) {
    const log = path.join(directory, `${stamp}-${name}.log`), stream = createWriteStream(log);
    console.log(`Running ${name}`);
    const code = await new Promise((resolve, reject) => { const child = spawn(cmd, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }); child.stdout.pipe(stream, { end: false }); child.stderr.pipe(stream, { end: false }); child.once('error', reject); child.once('close', resolve); });
    await new Promise(resolve => stream.end(resolve));
    const step = { name, exitCode: code, log };
    report.steps.push(step);
    if (code !== 0)
        throw Error(`${name} failed (${code}); see ${log}`);
    return await readFile(log, 'utf8');
}
try {
    await run('compile', 'npm', ['run', 'compile']);
    const testFile = path.join(directory, `${stamp}-unit.json`);
    await run('unit', 'npm', ['test', '--', '--reporter=json', `--outputFile=${testFile}`]);
    const tests = JSON.parse(await readFile(testFile, 'utf8'));
    report.tests = { passed: tests.numPassedTests, total: tests.numTotalTests, success: tests.success, report: testFile };
    await run('build', 'npm', ['run', 'build']);
    for (let i = 0; i < repeat; i++)
        for (const browser of ['pwa', 'firefox']) {
            const output = await run(`ui-${browser}-${i + 1}`, process.execPath, ['features/ai/eval/ui.mjs', ...(browser === 'firefox' ? ['--firefox'] : [])]);
            const line = output.trim().split('\n').findLast(line => line.startsWith('{"report":'));
            if (!line)
                throw Error('UI result missing');
            report.steps.at(-1).result = JSON.parse(line);
        }
    report.passed = true;
}
catch (error) {
    report.error = String(error.stack);
    report.passed = false;
    process.exitCode = 1;
    console.error(report.error);
}
finally {
    const file = path.join(directory, `${stamp}-verification.json`);
    await writeFile(file, JSON.stringify(report, null, 2) + '\n');
    console.log(`Report: ${file}`);
}
