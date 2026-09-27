#!/usr/bin/env node
// Generates src/i18n/<lang>.json from src/i18n/en.json with Grok (xAI chat completions).
//   XAI_API_KEY=... node scripts/translate-i18n.mjs            # every language
//   XAI_API_KEY=... node scripts/translate-i18n.mjs es ar      # just these
// Model: the DEFAULT_MODEL in supabase/functions/make-plan/index.ts (override with GROK_MODEL).
// Every key and every {placeholder} must survive; bad output is retried, then the language fails loudly.
// The key is read from the environment only and is never printed or written anywhere.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const i18nDir = join(root, "src/i18n");
const LANGUAGES = {
  es: "Spanish (Latin American, informal tú)",
  fr: "French (informal tu)",
  de: "German (informal du)",
  pt: "Portuguese (Brazilian, informal você)",
  zh: "Simplified Chinese",
  ko: "Korean (polite 해요체)",
  hi: "Hindi (Devanagari, conversational)",
  ar: "Arabic (Modern Standard, friendly)",
};

const apiKey = process.env.XAI_API_KEY;
if (!apiKey) {
  console.error("XAI_API_KEY is not set. Nothing was generated; the app falls back to English.");
  process.exit(1);
}
const makePlan = readFileSync(join(root, "supabase/functions/make-plan/index.ts"), "utf8");
const model = process.env.GROK_MODEL || makePlan.match(/DEFAULT_MODEL\s*=\s*"([^"]+)"/)?.[1];
if (!model) throw new Error("Couldn't find DEFAULT_MODEL in make-plan/index.ts; set GROK_MODEL");

const en = JSON.parse(readFileSync(join(i18nDir, "en.json"), "utf8"));
const keys = Object.keys(en);
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

const schema = {
  type: "object",
  additionalProperties: false,
  required: keys,
  properties: Object.fromEntries(keys.map((k) => [k, { type: "string" }])),
};

const system = (language) => `You are translating the UI of Quorum, a mobile web app where a friend group answers a few private questions and Grok (an AI) plans an outing in Atlanta that works for everyone; then they vote on the plans.
Translate every value of the JSON object from English into ${language}.
Rules:
- Return a JSON object with exactly the same keys. Never translate or change keys.
- Keep every {placeholder} exactly as written (same name, same braces), e.g. {name}, {count}, {group}. Reorder them if the grammar needs it.
- Do not translate the brand names "Quorum", "Grok", "Grok Imagine", "Atlanta".
- Keep emoji, symbols (✓ ✨ 🔒 · → …), "$" and straight double quotes around {placeholders} as they are.
- Keys ending in _one / _other are the singular / plural forms of the same text.
- Short, natural, friendly wording that fits a phone button or label. Match the English tone (casual, clear).
- "I'm in" means "count me in" (voting for a plan). "Lobby" is the waiting room before planning. A "hard no" is something a person refuses to do.`;

function problems(out) {
  const errs = [];
  if (!out || typeof out !== "object") return ["not an object"];
  for (const k of keys) {
    if (typeof out[k] !== "string" || !out[k].trim()) errs.push(`missing ${k}`);
    else if (placeholders(out[k]) !== placeholders(en[k])) errs.push(`${k}: placeholders must be {${placeholders(en[k])}}`);
  }
  for (const k of Object.keys(out)) if (!(k in en)) errs.push(`unexpected key ${k}`);
  return errs;
}

async function translate(lang) {
  const messages = [
    { role: "system", content: system(LANGUAGES[lang]) },
    { role: "user", content: JSON.stringify(en, null, 1) },
  ];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages,
        reasoning_effort: "low",
        response_format: { type: "json_schema", json_schema: { name: "quorum_ui_strings", schema, strict: true } },
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) throw new Error(`${lang}: xAI API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const content = (await res.json())?.choices?.[0]?.message?.content;
    let out;
    try {
      out = JSON.parse(content);
    } catch {
      messages.push({ role: "user", content: "That was not valid JSON. Return the JSON object only." });
      continue;
    }
    const errs = problems(out);
    if (errs.length === 0) {
      const ordered = Object.fromEntries(keys.map((k) => [k, out[k]]));
      writeFileSync(join(i18nDir, `${lang}.json`), JSON.stringify(ordered, null, 2) + "\n");
      console.log(`${lang}: ${keys.length} strings -> src/i18n/${lang}.json (attempt ${attempt})`);
      return;
    }
    console.warn(`${lang}: attempt ${attempt} had ${errs.length} problem(s): ${errs.slice(0, 5).join("; ")}`);
    messages.push({ role: "assistant", content }, { role: "user", content: `Fix these problems and return the full JSON object: ${errs.slice(0, 30).join("; ")}` });
  }
  throw new Error(`${lang}: still invalid after 3 attempts`);
}

const wanted = process.argv.slice(2);
const langs = wanted.length ? wanted : Object.keys(LANGUAGES);
for (const l of langs) if (!(l in LANGUAGES)) throw new Error(`Unknown language "${l}". Known: ${Object.keys(LANGUAGES).join(" ")}`);
console.log(`Translating ${keys.length} strings into ${langs.join(", ")} with ${model}…`);
const results = await Promise.allSettled(langs.map(translate));
const failed = results.map((r, i) => r.status === "rejected" && `${langs[i]}: ${r.reason?.message ?? r.reason}`).filter(Boolean);
if (failed.length) {
  console.error(`Failed:\n${failed.join("\n")}`);
  process.exit(1);
}
