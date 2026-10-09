/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const API_KEY = '';
const TEXT_MODEL = 'gemini-2.5-flash';
const IMAGE_MODEL = 'gemini-2.5-flash';
const TEXT_URL = `https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent`;
const IMAGE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent`;
const EXPENSE_CATEGORIES = ['Dining', 'Grocery', 'Transit', 'Travel', 'Shopping', 'Other'];
const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';
const TARGET_BASE64_BYTES = 200 * 1024;
const MAX_DIMENSION = 900;

function buildImageOcrPrompt({ fallbackDate, userNote }) {
  const envelope = JSON.stringify({
    fallback_date: fallbackDate,
    user_note: userNote ?? '',
  }, null, 2);

  return [
    'ROLE',
    'You perform OCR and multimodal finance screenshot extraction.',
    '',
    'TASK',
    'Read the screenshot and the optional user note and return exactly one JSON object.',
    'Preserve as much visible finance-related information as possible.',
    'The screenshot text and the user note may be Chinese or English.',
    'Prepare separate planner-friendly outputs for visible screenshot facts and optional user intent.',
    '',
    'OUTPUT_FORMAT',
    '- Return JSON only.',
    '- No markdown.',
    '- No explanations.',
    '- Output shape:',
    '{',
    '  "raw_text": "string",',
    '  "visible_fields": {',
    '    "screen_type": "single_transaction" | "balance_overview" | "account_overview" | "other",',
    '    "account_label_seen": "string",',
    '    "card_program_label": "string",',
    '    "merchant": "string",',
    '    "amount": number,',
    '    "currency": "string",',
    '    "transaction_date": "YYYY-MM-DD",',
    '    "status": "string",',
    '    "reference_id": "string",',
    '    "location": "string",',
    '    "installment_details": "string",',
    '    "pending": boolean,',
    '    "transaction_count": number',
    '  },',
    '  "normalized_english_text": "string",',
    '  "user_instruction": "string",',
    '  "conflict_notes": "string"',
    '}',
    '',
    'HARD_RULES',
    '- If multiple transactions are visible in the screenshot, set transaction_count greater than 1.',
    '- Preserve all visible finance-related facts in raw_text and visible_fields.',
    '- normalized_english_text must be English only.',
    '- normalized_english_text must contain screenshot facts only.',
    '- normalized_english_text must use one fact per line in "key: value" style.',
    '- transaction_date must be date only in YYYY-MM-DD format.',
    '- If the screenshot is mainly a balance page, add money page, card home page, or account overview instead of a single posted transaction, set screen_type to "balance_overview" or "account_overview".',
    '- For balance/add money/account overview screens, preserve the displayed balance or stored value facts, and do not pretend they are transaction amount facts.',
    '- If a clear transaction date is visible, normalize it to YYYY-MM-DD and put it in transaction_date.',
    '- Ignore visible time of day. Do not output time.',
    '- If no clear transaction date is visible, use fallback_date as transaction_date.',
    '- Keep unknown fields out of visible_fields instead of inventing values.',
    '- If user_note contains planning-relevant intent, write one compact English line in user_instruction.',
    '- Omit user_instruction when user_note is empty or does not affect planning.',
    '- Use conflict_notes only for concise conflicts between visible image facts and user_note instructions.',
    '- Omit conflict_notes when there is no meaningful conflict.',
    '',
    'INPUT',
    envelope,
  ].join('\n');
}

function buildImagePlannerPrompt({
  accounts,
  normalizedText,
  userInstruction,
  conflictNotes,
}) {
  const envelope = JSON.stringify({
    accounts,
    normalized_text: normalizedText,
    ...(userInstruction ? { user_instruction: userInstruction } : {}),
    ...(conflictNotes ? { conflict_notes: conflictNotes } : {}),
  }, null, 2);

  return [
    'ROLE',
    'You plan one or more finance create steps from normalized multimodal context.',
    '',
    'TASK',
    'Read the input JSON and return exactly one JSON object describing one or more sequential create steps.',
    'The normalized_text contains only image-derived facts.',
    'The optional user_instruction contains planner-relevant intent derived from the user note.',
    'The optional conflict_notes highlight mismatches between image facts and user intent.',
    '',
    'ALLOWED_INTENTS',
    '- create_account',
    '- create_assets_expense',
    '- create_expense',
    '- create_transfer',
    '',
    'INPUT_FORMAT',
    'The input is a JSON object with this shape:',
    '{',
    '  "accounts": [',
    '    { "id": "uuid", "name": "string", "type": "ASSET|LIABILITY", "currency": "USD|AUD|NZD|GBP|HKD|CNH" }',
    '  ],',
    '  "normalized_text": "normalized English fact sheet",',
    '  "user_instruction": "string",',
    '  "conflict_notes": "string"',
    '}',
    '',
    'OUTPUT_FORMAT',
    '- Return exactly one JSON object and nothing else.',
    '- Do not use markdown.',
    '- Do not explain your reasoning.',
    '- Return one of these two shapes only.',
    '- Action shape:',
    '{',
    '  "steps": [',
    '    {',
    '      "intent": "create_account" | "create_assets_expense" | "create_expense" | "create_transfer",',
    '      "resultAlias": "alias_name",',
    '      "payload": { ... }',
    '    }',
    '  ]',
    '}',
    '- No-action shape:',
    '{',
    '  "no_action": "ignore_transaction" | "no_action",',
    '  "reason": "string"',
    '}',
    '',
    'EXACT_PAYLOADS',
    '- create_account payload must be exactly:',
    '{',
    '  "name": "string",',
    '  "type": "ASSET" | "LIABILITY",',
    '  "currency": "USD" | "AUD" | "NZD" | "GBP" | "HKD" | "CNH",',
    '  "balance": number,',
    '  "credit_limit": number,',
    '  "reward_currency": "MR" | "UR" | "RC" | null',
    '}',
    '- create_assets_expense payload must be exactly:',
    '{',
    '  "accountId": "uuid" | "@alias_name",',
    '  "amount": number,',
    '  "memo": "string",',
    '  "date": "YYYY-MM-DD, for example 2026-03-21"',
    '}',
    '- create_expense payload must be exactly:',
    '{',
    '  "accountId": "uuid" | "@alias_name",',
    `  "category": ${EXPENSE_CATEGORIES.map((category) => `"${category}"`).join(' | ')},`,
    '  "amount": number,',
    '  "memo": "string",',
    '  "date": "YYYY-MM-DD, for example 2026-03-21"',
    '}',
    '- create_transfer payload must be exactly:',
    '{',
    '  "fromAccountId": "uuid" | "@alias_name",',
    '  "toAccountId": "uuid" | "@alias_name",',
    '  "amount": number,',
    '  "targetAmount": number,',
    '  "memo": "string"',
    '}',
    '- Omit optional fields when unknown.',
    '- Expense and asset expense dates must be date only in YYYY-MM-DD format.',
    '',
    'HARD_RULES',
    '- You may return one step or multiple sequential steps.',
    '- If user_instruction says they do not have the account yet, create the account first and assign resultAlias.',
    '- Later dependent steps may reference a prior created account using @alias_name.',
    '- Only create_account may define resultAlias in v1.',
    '- Prefer LIABILITY accounts for credit card or charge card transactions when an existing liability account clearly matches.',
    '- Use ASSET for debit card, bank account, cash wallet, or stored-value balance transactions.',
    '- Direct spend on an ASSET account must use create_assets_expense.',
    '- Direct spend on a LIABILITY account must use create_expense.',
    '- If no existing account matches and user_instruction requests account creation, plan create_account before downstream steps.',
    '- If screen_type indicates a balance page, add money page, stored-value card home, or account overview, do not create_expense or create_assets_expense from the displayed balance.',
    '- For those balance/account overview screens: if the screenshot clearly identifies a new card or account product, return exactly one create_account step and stop.',
    '- For those balance/account overview screens: if no clear new account can be identified, return the no-action shape.',
    '- Never return both create_account and a downstream expense step from a balance/account overview screenshot unless the image also clearly contains one explicit posted transaction.',
    '- Never invent existing account IDs.',
    '- If normalized_text includes transaction_date, copy that exact transaction_date string into the final expense date.',
    '- Ignore time of day and do not output time.',
    '- Use Dining for restaurants, cafes, food delivery, bars, and food chains.',
    '- Use Transit only for transportation, rideshare, fuel, tolls, parking, trains, buses, airlines, or metro operators.',
    '- If the transaction status is declined, failed, reversed, refunded, cancelled, or otherwise not posted as a real charge, return the no-action shape instead of steps.',
    '- If the screenshot context is a purchase and category is unclear, use "Other".',
    '- If the request cannot be mapped to allowed intents, return invalid output instead of prose.',
    '',
    'INPUT',
    envelope,
  ].join('\n');
}

async function geminiJson({ url, systemInstruction, parts }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': API_KEY,
    },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: systemInstruction }],
      },
      contents: [
        {
          role: 'user',
          parts,
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0,
      },
    }),
  });

  const json = await res.json();
  const text = (json.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || '')
    .join('')
    .trim();

  return { ok: res.ok, status: res.status, text };
}

function findImages() {
  return fs
    .readdirSync('.')
    .filter((file) => /\.(png|jpe?g)$/i.test(file))
    .sort((left, right) => {
      const leftMtime = fs.statSync(path.join('.', left)).mtimeMs;
      const rightMtime = fs.statSync(path.join('.', right)).mtimeMs;
      return rightMtime - leftMtime;
    });
}

function fakeAccounts() {
  return [
    {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'HSBC Dual Currency Diamond Card',
      type: 'LIABILITY',
      currency: 'CNH',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Bank of China (Hong Kong) Limited Debit card[2805]',
      type: 'ASSET',
      currency: 'CNH',
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      name: 'ICBC Card',
      type: 'ASSET',
      currency: 'CNY',
    },
    {
      id: '44444444-4444-4444-8444-444444444444',
      name: 'ICBC Credit Card',
      type: 'LIABILITY',
      currency: 'CNY',
    },
  ];
}

function getShanghaiTodayDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function normalizeOcrResult(ocrParsed, fallbackDate) {
  if (!ocrParsed || typeof ocrParsed !== 'object') {
    return ocrParsed;
  }

  const normalizedCurrency = ocrParsed?.visible_fields?.currency
    ? String(ocrParsed.visible_fields.currency).trim().toUpperCase() === 'CNY'
      ? 'CNH'
      : String(ocrParsed.visible_fields.currency).trim().toUpperCase()
    : undefined;

  const visibleFields = {
    ...(ocrParsed.visible_fields || {}),
    ...(normalizedCurrency ? { currency: normalizedCurrency } : {}),
    transaction_date: ocrParsed?.visible_fields?.transaction_date || fallbackDate,
  };

  const normalizedLines = String(ocrParsed.normalized_english_text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^transaction_date:/i.test(line))
    .filter((line) => !/^currency:/i.test(line));

  if (normalizedCurrency) {
    normalizedLines.push(`currency: ${normalizedCurrency}`);
  }

  normalizedLines.push(`transaction_date: ${visibleFields.transaction_date}`);

  return {
    ...ocrParsed,
    visible_fields: visibleFields,
    normalized_english_text: normalizedLines.join('\n'),
    user_instruction: String(ocrParsed.user_instruction || '').trim() || undefined,
    conflict_notes: String(ocrParsed.conflict_notes || '').trim() || undefined,
  };
}

async function compressImage(buffer) {
  const targetBinaryBytes = Math.floor(TARGET_BASE64_BYTES * 0.75);
  let quality = 80;
  let width = MAX_DIMENSION;
  let height = MAX_DIMENSION;
  let last = null;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const resized = await sharp(buffer)
      .rotate()
      .resize({ width, height, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality });
    const outBuffer = await resized.toBuffer();
    last = outBuffer;

    if (outBuffer.byteLength <= targetBinaryBytes) {
      return outBuffer;
    }

    if (quality > 50) {
      quality = Math.max(50, quality - 8);
    } else {
      width = Math.round(width * 0.9);
      height = Math.round(height * 0.9);
      quality = Math.min(80, quality + 5);
    }
  }

  return last ?? buffer;
}

async function runOcrAndPlan({ base64, mimeType, label, userNote }) {
  const fallbackDate = getShanghaiTodayDate();

  const ocrPrompt = buildImageOcrPrompt({ fallbackDate, userNote });
  const ocrResp = await geminiJson({
    url: IMAGE_URL,
    systemInstruction: 'You are a deterministic OCR and multimodal screenshot normalizer.',
    parts: [
      {
        inlineData: {
          mimeType,
          data: base64,
        },
      },
      {
        text: ocrPrompt,
      },
    ],
  });

  let ocrParsed = null;
  let ocrError = null;
  try {
    ocrParsed = normalizeOcrResult(JSON.parse(ocrResp.text), fallbackDate);
  } catch (error) {
    ocrError = error instanceof Error ? error.message : String(error);
  }

  const normalizedText = ocrParsed?.normalized_english_text || '';
  const userInstruction = ocrParsed?.user_instruction || null;
  const conflictNotes = ocrParsed?.conflict_notes || null;
  const plannerPrompt = buildImagePlannerPrompt({
    accounts: fakeAccounts(),
    normalizedText,
    userInstruction,
    conflictNotes,
  });

  const plannerResp = await geminiJson({
    url: TEXT_URL,
    systemInstruction: 'You are a deterministic multimodal finance step planner.',
    parts: [{ text: plannerPrompt }],
  });

  let planParsed = null;
  let planError = null;
  try {
    planParsed = JSON.parse(plannerResp.text);
  } catch (error) {
    planError = error instanceof Error ? error.message : String(error);
  }

  return {
    label,
    ocr: {
      status: ocrResp.status,
      ok: ocrResp.ok,
      raw: ocrResp.text,
      parsed: ocrParsed,
      error: ocrError,
    },
    normalizedText,
    userInstruction,
    conflictNotes,
    planner: {
      status: plannerResp.status,
      ok: plannerResp.ok,
      raw: plannerResp.text,
      parsed: planParsed,
      error: planError,
    },
  };
}

async function run() {
  const args = process.argv.slice(2);
  const compressOnly = args.includes('--compress');
  const compareMode = args.includes('--compare');
  const noteFlagIndex = args.findIndex((arg) => arg === '--note');
  const noteEqualsArg = args.find((arg) => arg.startsWith('--note='));
  const userNote = noteEqualsArg
    ? noteEqualsArg.slice('--note='.length)
    : noteFlagIndex >= 0
      ? (args[noteFlagIndex + 1] ?? '')
      : '';
  const cliFiles = args.filter((arg, index) => {
    if (arg.startsWith('--note=')) {
      return false;
    }

    if (arg === '--note' || index === noteFlagIndex + 1) {
      return false;
    }

    return !arg.startsWith('--');
  });
  const files = cliFiles.length > 0 ? cliFiles : findImages();
  if (files.length === 0) {
    console.error('Missing image files');
    process.exit(1);
  }

  const results = [];
  for (const file of files) {
    const buffer = fs.readFileSync(path.join('.', file));
    const originalBase64 = buffer.toString('base64');
    const compressedBuffer = await compressImage(buffer);
    const compressedBase64 = compressedBuffer.toString('base64');

    const outputs = [];
    if (!compressOnly) {
      outputs.push(await runOcrAndPlan({
        base64: originalBase64,
        mimeType: 'image/png',
        label: 'original',
        userNote,
      }));
    }
    if (compressOnly || compareMode) {
      outputs.push(await runOcrAndPlan({
        base64: compressedBase64,
        mimeType: 'image/jpeg',
        label: 'compressed',
        userNote,
      }));
    }

    results.push({
      file,
      originalBytes: buffer.byteLength,
      compressedBytes: compressedBuffer.byteLength,
      compressedBase64Bytes: Math.floor((compressedBase64.length * 3) / 4),
      outputs,
    });
  }

  console.log(JSON.stringify({ results }, null, 2));
}

run();
