import puppeteer from 'puppeteer-core';
import { writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url))), artifacts = path.join(root, '.artifacts/ai');
await mkdir(artifacts, { recursive: true });
const runId = new Date().toISOString().replaceAll(':', '-');
const artifact = name => path.join(artifacts, `${runId}-${name}`);
let server, browser;
const isFirefox = process.argv.includes('--firefox');
const extensionUuid = 'ad165a15-0468-48b5-a2f2-457194c55d20';
const report = { surface: isFirefox ? 'Firefox installed extension' : 'PWA', mode: 'Fixed remote Responses outputs; real UI, ledger and registry. Model accuracy evaluated separately.', checks: [], calls: 0 };
let current = { steps: [] };
let page;
report.errors = [];
try {
    if (!isFirefox) {
        server = await createServer({ configFile: path.join(root, 'vite.pwa.config.ts'), cacheDir: path.join(root, 'node_modules/.vite-ai-ui'), server: { host: '127.0.0.1', port: 4180, strictPort: true } });
        await server.listen();
    }
    browser = await puppeteer.launch({ browser: isFirefox ? 'firefox' : 'chrome', executablePath: isFirefox ? '/Applications/Firefox.app/Contents/MacOS/firefox' : '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: !isFirefox, userDataDir: path.join(artifacts, 'profiles', `${isFirefox ? 'ui-firefox' : 'ui-pwa'}-${runId}`), ...(isFirefox ? { args: ['--remote-allow-system-access'], extraPrefsFirefox: { 'extensions.webextensions.uuids': JSON.stringify({ 'foliodude@foliodude.it.com': extensionUuid }) } } : {}) });
    if (isFirefox) {
        report.extensionId = await browser.installExtension(path.join(root, '.output/firefox-mv3'));
    }
    page = await browser.newPage();
    page.setDefaultTimeout(60000);
    page.on('pageerror', error => report.errors.push(String(error)));
    await page.setViewport({ width: isFirefox ? 390 : 1000, height: 900 });
    await page.setRequestInterception(true);
    const handleRequest = async (req) => {
        if (!req.url().startsWith('https://recovery-ui.example.invalid/'))
            return req.continue();
        if (req.method() === 'OPTIONS')
            return req.respond({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': req.headers()['access-control-request-headers'] || '*' } });
        report.calls++;
        const body = JSON.parse(isFirefox ? await req.fetchPostData() : req.postData());
        if (body.temperature !== 0 || body.max_output_tokens !== 2048 || body.store !== false || !body.instructions.includes('ledger') || !body.input.includes('request'))
            throw Error('Unexpected request contract');
        return req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ id: 'resp_ui', object: 'response', status: 'completed', output: [{ type: 'message', id: 'msg_ui', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: typeof current === 'string' ? current : JSON.stringify(current), annotations: [] }] }] }) });
    };
    let rejectRequest;
    const requestFailure = new Promise((_, reject) => { rejectRequest = reject; });
    // The main flow awaits this through contains(); prevent an earlier unhandled rejection.
    void requestFailure.catch(() => {});
    page.on('request', req => {
        void handleRequest(req).catch(async error => {
            report.errors.push(String(error));
            rejectRequest(error);
            try { await req.abort(); } catch (abortError) { report.errors.push(String(abortError)); }
        });
    });
    const click = async (label) => { await page.waitForFunction(label => Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === label && !b.disabled), {}, label); await page.evaluate(label => Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === label && !b.disabled).click(), label); };
    const fill = async (selector, value) => page.$eval(selector, (el, value) => { Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); }, value);
    const contains = async (text) => Promise.race([page.waitForFunction(text => document.body.innerText.includes(text), {}, text), requestFailure]);
    const record = name => report.checks.push({ name, passed: true });
    const url = isFirefox ? `moz-extension://${extensionUuid}/sidepanel.html` : 'http://127.0.0.1:4180/';
    if (isFirefox) {
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        }
        catch (error) {
            if (error.name !== 'TimeoutError')
                throw error;
        }
        await page.waitForFunction(() => Array.from(document.querySelectorAll('a')).some(a => a.textContent.trim() === 'Lab'));
        await page.evaluate(() => Array.from(document.querySelectorAll('a')).find(a => a.textContent.trim() === 'Lab').click());
    }
    else
        await page.goto(url + '#/lab');
    await page.waitForSelector('#llm-key');
    await page.evaluate(() => Array.from(document.querySelectorAll('summary')).find(s => s.textContent.trim() === 'AI settings and API keys')?.click());
    await fill('#llm-base-url', 'https://recovery-ui.example.invalid/v1');
    await fill('#llm-model', 'fixture');
    await fill('#llm-key', 'fixture-only');
    await click('Save');
    await contains('Saved');
    if (!isFirefox)
        await page.evaluate(async (root) => { const { getDb } = await import(`/@fs${root}/lib/db/client.ts`); await (await getDb()).exec('TRUNCATE accounts RESTART IDENTITY CASCADE'); }, root);
    const generate = async (text, steps) => { current = { steps }; await fill('#intent-request', text); await click('Generate preview'); await contains(`Review ${steps.length} ${steps.length === 1 ? 'change' : 'changes'}`); };
    const save = async (count) => { await click(`Save ${count} ${count === 1 ? 'change' : 'changes'}`); await contains(`Saved ${count} ${count === 1 ? 'change' : 'changes'}`); };
    const snapshot = async () => page.evaluate(async (root) => { const { getDb } = await import(`/@fs${root}/lib/db/client.ts`); const db = await getDb(); return { accounts: (await db.query('SELECT name,balance FROM accounts ORDER BY name')).rows, transactions: (await db.query('SELECT amount FROM transactions ORDER BY seq')).rows }; }, root);
    await generate('创建一个账户, 叫chase', [{ action: 'create_account', name: 'chase' }]);
    await contains('Starting balance: $0.00');
    await contains('No transaction will be created.');
    if (!isFirefox) {
        const before = await snapshot();
        if (before.accounts.length || before.transactions.length)
            throw Error('Preparation wrote rows');
        record('Preparation is read-only');
    }
    await fill('#intent-0-balance', '');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'Save 1 change')?.disabled);
    record('Invalid fields disable Save');
    await fill('#intent-0-balance', '300');
    await save(1);
    record('Edited opening balance saved without another inference call');
    await generate('建立信用卡，负债20美元', [{ action: 'create_account', name: '信用卡', type: 'LIABILITY', balance: -20 }]);
    await contains('Amount owed');
    await save(1);
    record('Initial debt saved without transaction');
    await generate('Add Wallet with 100 and Bank with 10', [{ action: 'create_account', name: 'Wallet', balance: 100 }, { action: 'create_account', name: 'Bank', balance: 10 }]);
    await save(2);
    record('Multiple openings saved together');
    await generate('Spend 12 from Wallet; move its remaining funds to Bank', [{ action: 'expense', account: 'Wallet', amount: 12 }, { action: 'transfer', from: 'Wallet', to: 'Bank', amount: 'all' }]);
    await contains('Estimated transfer: $88.00');
    record('Preview includes earlier expense before all-transfer');
    if (!isFirefox)
        await page.screenshot({ path: artifact('recovery-pwa-review.png'), fullPage: true });
    else
        report.reviewText = await page.evaluate(() => document.body.innerText);
    if (!isFirefox) {
        await page.evaluate(async (root) => { const { getSessionContext } = await import(`/@fs${root}/lib/db/session.ts`); const { adjustBalance } = await import(`/@fs${root}/lib/db/ledger.ts`); const { db } = await getSessionContext(); const { rows } = await db.query("SELECT id FROM accounts WHERE name='Wallet'"); await db.transaction(tx => adjustBalance(tx, rows[0].id, 5)); }, root);
        await click('Save 2 changes');
        await contains('Accounts changed.');
        const before = await snapshot();
        if (before.transactions.length)
            throw Error('Stale save wrote transactions');
        await click('Refresh preview');
        await contains('Estimated transfer: $93.00');
        record('Stale balance blocks Save and refresh requires review');
    }
    await save(2);
    record('Explicit Save completes atomic dependent steps');
    current = { clarification: 'Which destination account should receive the money?' };
    await fill('#intent-request', 'Move all money from Wallet');
    await click('Generate preview');
    await contains('One more detail');
    await contains('Which destination');
    record('Clarification keeps request visible');
    current = { steps: [] };
    await fill('#intent-request', 'Do not transfer anything');
    await click('Generate preview');
    await contains('No changes to save');
    record('No-action offers no Save');
    current = '{"steps":[]}\nHere is an explanation.';
    await fill('#intent-request', 'test malformed output');
    await click('Generate preview');
    await contains('The AI could not produce a valid preview');
    await contains('Technical details');
    record('Friendly error with collapsed diagnostics');
    await generate('create Draft Only', [{ action: 'create_account', name: 'Draft Only' }]);
    await fill('#intent-request', 'Different request');
    await page.waitForFunction(() => !document.body.innerText.includes('Review 1 change'));
    record('Editing original request invalidates draft');
    if (!isFirefox) {
        const after = await snapshot();
        report.ledger = after;
        if (JSON.stringify(after.accounts) !== JSON.stringify([{ name: 'Bank', balance: 103 }, { name: 'Wallet', balance: 0 }, { name: 'chase', balance: 300 }, { name: '信用卡', balance: -20 }]) || JSON.stringify(after.transactions) !== JSON.stringify([{ amount: 12 }, { amount: 93 }]))
            throw Error('Unexpected final ledger ' + JSON.stringify(after));
    }
    if (!isFirefox) {
        const choose = async (selector, label) => { await page.focus(selector); await page.keyboard.press('Space'); await page.waitForFunction(label => Array.from(document.querySelectorAll('[role=option]')).some(o => o.textContent.trim() === label), {}, label); const option = await page.evaluateHandle(label => Array.from(document.querySelectorAll('[role=option]')).find(o => o.textContent.trim() === label && o.getClientRects().length), label); await option.asElement().click(); await option.dispose(); };
        await generate('create Editable Preview', [{ action: 'create_account', name: 'Editable Preview' }]);
        await fill('#intent-0-name', 'Edited Preview');
        await choose('#intent-0-type', 'Credit card / debt');
        await choose('#intent-0-currency', 'EUR');
        await fill('#intent-0-balance', '7');
        await contains('Create Edited Preview');
        await contains('Amount owed: €7.00');
        record('Name, account type and currency are editable');
        await generate('move 3 from Wallet to Bank', [{ action: 'transfer', from: 'Wallet', to: 'Bank', amount: 3 }]);
        await choose('#intent-0-from', 'Bank (USD)');
        await choose('#intent-0-to', 'Wallet (USD)');
        await fill('#intent-0-amount', '9');
        await contains('Bank → Wallet');
        await contains('Amount: $9.00');
        record('Account selections and transfer amount are editable');
        await generate('create Currency Fund with 50 USD and spend 5 from it', [{ action: 'create_account', name: 'Currency Fund', balance: 50, currency: 'USD' }, { action: 'expense', account: 'Currency Fund', amount: 5, currency: 'USD' }]);
        await choose('#intent-0-currency', 'EUR');
        await fill('#intent-0-name', 'Currency Edited');
        await contains('Currency Edited (EUR)');
        await contains('Amount: €5.00');
        record('Dependent references follow edited account name and currency');
        await page.setViewport({ width: 390, height: 844 });
        await page.focus('#intent-request');
        await page.keyboard.press('Tab');
        const accessible = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, focus: document.activeElement?.textContent }));
        if (accessible.overflow || accessible.focus !== 'Generate preview')
            throw Error('Keyboard/mobile layout check failed ' + JSON.stringify(accessible));
        record('Keyboard focus and narrow viewport verified');
        await page.screenshot({ path: artifact('recovery-pwa-mobile.png'), fullPage: true });
    }
    if (isFirefox)
        await page.evaluate(() => Array.from(document.querySelectorAll('a')).find(a => a.textContent.trim() === 'Accounts').click());
    else
        await page.goto(url + '#/accounts');
    await contains('Bank');
    await contains(isFirefox ? '$98.00' : '$103.00');
    await contains('$300.00');
    if (!isFirefox)
        await page.screenshot({ path: artifact('recovery-pwa-accounts.png'), fullPage: true });
    else {
        report.accountsText = await page.evaluate(() => document.body.innerText);
        report.screenshotNote = 'Firefox BiDi cannot screenshot privileged extension documents; DOM flow and final account values verified.';
    }
    if (report.errors.length)
        throw Error(report.errors.join("\n"));
    report.passed = true;
}
catch (error) {
    if (page) {
        report.body = await page.evaluate(() => document.body.innerText).catch(() => null);
        await page.screenshot({ path: artifact(isFirefox ? 'recovery-extension-error.png' : 'recovery-pwa-error.png'), fullPage: true }).catch(() => { });
    }
    report.error = String(error.stack);
    process.exitCode = 1;
    console.error(report.error);
}
finally {
    await writeFile(artifact(isFirefox ? 'recovery-ui-extension.json' : 'recovery-ui-pwa.json'), JSON.stringify(report, null, 2));
    await browser?.close();
    await server?.close();
    console.log(JSON.stringify({ report: artifact(isFirefox ? 'recovery-ui-extension.json' : 'recovery-ui-pwa.json'), surface: report.surface, passed: report.passed, checks: report.checks.length, calls: report.calls }));
}
