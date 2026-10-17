import { summarizeReport, evaluationPassed } from './report-utils.mjs';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const args = process.argv.slice(2);
const value = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; };
if (args.includes('--help')) {
  console.log('npm run harness:ai -- [--browser edge|chrome|firefox] [--folder /path/to/compiled-model] [--mode ledger|extraction] [--cases comma,separated,ids] [--repeat 1] [--suite core|regression|holdout] [--remote]');
  console.log('Default: the 10-case core suite (manifest coreIds). regression (53) and holdout (68) are archived full suites; run them only on request.');
  console.log('--remote: the Responses endpoint in the gitignored config.json ({"remote":{"baseUrl","model","apiKey","tokensPerMinute"}}), paced to its token limit.');
  console.log('Uses a managed test profile and isolated synthetic ledger on 127.0.0.1:4175. Default source: direct Hugging Face URL. Set FOLIO_AI_BROWSER_PATH for other installed browser locations.');
  process.exit(0);
}
const browserName = value('--browser', 'edge');
const mode = value('--mode', 'ledger');
const suite = value('--suite', 'core');
const repeat = Number(value('--repeat', '1'));
if (!['core', 'regression', 'holdout'].includes(suite) || !['edge', 'chrome', 'firefox'].includes(browserName) || !['ledger', 'extraction'].includes(mode) || !Number.isInteger(repeat) || repeat < 1) throw Error('Invalid browser, mode or repeat count. Use --help.');
const defaults = { edge: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', chrome: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', firefox: '/Applications/Firefox.app/Contents/MacOS/firefox' };
const executablePath = process.env.FOLIO_AI_BROWSER_PATH || defaults[browserName];
await stat(executablePath);
const folder = value('--folder');
// --remote runs the same pipeline against the Responses endpoint in the gitignored config.json; the key never enters the report.
const remote = args.includes('--remote') ? JSON.parse(await readFile(path.join(root, 'config.json'), 'utf8')).remote : null;
if (remote && folder) throw Error('Choose --remote or --folder, not both.');
const modelRoot = folder ? await realpath(path.resolve(folder)) : null;
const artifacts = path.join(root, '.artifacts/ai'); await mkdir(artifacts, { recursive: true });
const reportFile = path.join(artifacts, `${browserName}-${suite}-${mode}${remote ? '-remote' : ''}-${new Date().toISOString().replaceAll(':','-')}.json`);
const sourceFiles = ['package-lock.json', 'features/ai/application/intent-draft-actions.ts', 'features/ai/application/intent-draft.ts', 'features/ai/protocol/mlp.ts', 'features/ai/protocol/output-format.ts', 'features/ai/protocol/action-registry.ts', 'features/ai/providers/text-client.ts', 'features/ai/runtime/local-runtime.ts', 'features/ai/config.ts', 'lib/db/migrations/001_init.sql', 'features/ai/eval/cases.ts', 'features/ai/eval/expected-plans.ts', 'features/ai/eval/holdout-cases.ts', 'features/ai/eval/harness.ts', 'features/ai/eval/run.mjs', 'features/ai/eval/report-utils.mjs', 'features/ai/eval/fixtures/manifest.json', 'features/ai/application/ai-settings-actions.ts', 'features/ai/application/remote-settings.ts', 'lib/db/settings.ts', 'lib/db/session.ts', 'lib/db/ledger.ts', 'lib/sync/writer.ts', 'lib/actions/create-accounts-actions.ts', 'lib/actions/createAssetsExpense.ts', 'lib/actions/createTransaction.ts', 'lib/actions/createTransfer.ts', 'lib/types/accounts.ts', 'lib/utils/local-date.ts', 'lib/utils/fx-rates.ts', 'features/ai/eval/fixtures/exchange-rates.json', 'lib/utils/financial-analytics.ts', 'lib/db/client.ts', 'lib/db/tx.ts', 'lib/db/sql.ts', 'lib/data/expense-categories.ts', 'lib/types/rewards.ts'];
async function sourceHashes() {
  return Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, createHash('sha256').update(await readFile(path.join(root,file))).digest('hex')])));
}
const packageVersions = Object.fromEntries(await Promise.all(['everything-webgpu','openai'].map(async name => [name, JSON.parse(await readFile(path.join(root,'node_modules',name,'package.json'),'utf8')).version])));
const diagnosticOnly = args.includes('--cases');
const report = { diagnosticOnly, packageVersions, requestParameters: { temperature: 0, max_output_tokens: 2048, store: false }, browser: browserName, executablePath, mode, suite, folder: modelRoot, remote: remote && { baseUrl: remote.baseUrl, model: remote.model }, runs: [], consoleErrors: [], artifactErrors: [], sources: await sourceHashes() };
const flush = () => writeFile(reportFile, JSON.stringify(report, null, 2));
const server = await createServer({ configFile: false, root: path.join(root, 'features/ai/eval'),
  resolve: { alias: { '@': root } }, server: { host: '127.0.0.1', port: 4175, strictPort: true, fs: { allow: [root] } },
  plugins: [{ name: 'harness-model-files', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!modelRoot || !(req.url === '/model-files' || req.url?.startsWith('/model/'))) return next();
      try {
        if (req.url === '/model-files') {
          const entries = await readdir(modelRoot, { recursive: true });
          const files = [];
          for (const name of entries) {
            const file = await realpath(path.join(modelRoot, name));
            if (file.startsWith(modelRoot + path.sep) && (await stat(file)).isFile() && !name.split(path.sep).some(part => part.startsWith('.'))) files.push(name.split(path.sep).join('/'));
          }
          res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(files));
        }
        const file = await realpath(path.resolve(modelRoot, decodeURIComponent(req.url.slice('/model/'.length))));
        if (!file.startsWith(modelRoot + path.sep)) { res.statusCode = 403; return res.end(); }
        const info = await stat(file); res.setHeader('Content-Length', info.size); res.setHeader('Content-Type', 'application/octet-stream');
        const stream = createReadStream(file); stream.on('error', error => res.destroy(error)); stream.pipe(res);
      } catch (error) { res.statusCode = 404; res.end(String(error)); }
    });
  } }] });
let browser;
const wakeGuard = process.platform === 'darwin' ? spawn('caffeinate', ['-di', '-w', String(process.pid)], { stdio: 'ignore' }) : null;
try {
  await server.listen();
  browser = await puppeteer.launch({ browser: browserName === 'firefox' ? 'firefox' : 'chrome', executablePath, headless: false,
    userDataDir: path.join(artifacts, 'profiles', browserName), protocolTimeout: 120000,
    ...(browserName === 'firefox' ? { extraPrefsFirefox: { 'dom.webgpu.enabled': true, 'gfx.webgpu.ignore-blocklist': true } } : {}) });
  report.version = await browser.version();
  const page = await browser.newPage();
  const fxResponse = await readFile(path.join(root, 'features/ai/eval/fixtures/exchange-rates.json'), 'utf8');
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.url().startsWith('https://v6.exchangerate-api.com/v6/')) {
      void request.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: fxResponse });
    } else void request.continue();
  });
  page.on('pageerror', error => report.consoleErrors.push(String(error)));
  await page.goto('http://127.0.0.1:4175/');
  await page.waitForFunction(() => !!window.folioHarness, { timeout: 120000 });
  report.gpu = await page.evaluate(async () => { const a = await navigator.gpu?.requestAdapter(); return a ? { vendor: a.info?.vendor, architecture: a.info?.architecture, description: a.info?.description } : null; });
  for (let index = 0; index < repeat; index++) {
    if (index) { await page.reload(); await page.waitForFunction(() => !!window.folioHarness); }
    // The core suite is a fixed selection of regression fixtures, listed once in the manifest.
    const selected = value('--cases')?.split(',') ?? (suite === 'core' ? JSON.parse(await readFile(path.join(root, 'features/ai/eval/fixtures/manifest.json'), 'utf8')).coreIds : undefined);
    await page.evaluate(options => { void window.folioHarness.run(options); }, { folder: !!modelRoot, mode, suite, cases: selected, remote: remote && { baseUrl: remote.baseUrl, model: remote.model, apiKey: remote.apiKey, tokensPerMinute: remote.tokensPerMinute ?? 8000 } });
    const deadline = Date.now() + (suite === 'holdout' ? 60 : suite === 'core' ? 10 : 30) * 60_000; let previous;
    while (true) {
      const current = await page.evaluate(() => ({ ...window.folioHarness.state, runtime: window.folioHarness.runtime() }));
      report.runs[index] = current; await flush();
      const progress = `${current.phase}: ${current.runtime.label}`;
      if (progress !== previous) { console.log(progress); previous = progress; }
      if (current.done) break;
      if (Date.now() > deadline) throw Error('Harness run exceeded its time budget.');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    // A long JSON results page can exceed Firefox's canvas capture limit.
    // Screenshot capture is optional evidence and cannot erase completed case data.
    try { await page.screenshot({ path: reportFile.replace('.json', `-${index + 1}.png`), fullPage: false }); }
    catch (error) { report.artifactErrors.push({ run: index + 1, stage: 'screenshot', error: String(error) }); }
  }
  if (JSON.stringify(report.sources) !== JSON.stringify(await sourceHashes())) throw Error('Source changed during evaluation; discard this run.');
  // Label the output mode actually sent per call, not a declared constant.
  report.outputModes = [...new Set(report.runs.flatMap(run => run.results.flatMap(x => x.measurements.responses.map(call => call.outputMode))))];
  Object.assign(report, summarizeReport(report));
  if (!evaluationPassed(report, diagnosticOnly)) process.exitCode = 1;
  console.log(JSON.stringify(report.summary));
} catch (error) { report.fatal = error.stack || String(error); process.exitCode = 1; console.error(report.fatal); }
finally { await flush(); console.log(`Report: ${reportFile}`); await browser?.close(); await server.close(); wakeGuard?.kill(); }
