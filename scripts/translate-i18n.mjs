#!/usr/bin/env node
// Generates src/i18n/<lang>.json from src/i18n/en.json with Grok (xAI chat completions).
//   XAI_API_KEY=... node scripts/translate-i18n.mjs            # every language
//   XAI_API_KEY=... node scripts/translate-i18n.mjs es ar      # just these
//   node scripts/translate-i18n.mjs --missing                  # only keys missing from each file (keeps the rest as is)
// Model: the DEFAULT_MODEL in supabase/functions/make-plan/index.ts (override with GROK_MODEL).
// Without XAI_API_KEY it falls back to the TEMPORARY `gen-assets` Supabase function (action "translate"), which calls
// Grok with the project's GROK_API_KEY secret. It needs the token from GEN_ASSETS_TOKEN or ~/.gen-assets-token, plus
// VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (environment, .env.local or .env).
// Every key and every {placeholder} must survive; bad output is retried, then the language fails loudly.
// Keys and tokens are read from the environment/files only and are never printed or written anywhere.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const ONLY_MISSING = process.argv.includes("--missing");
import { homedir } from "node:os";
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

function dotenv(name) {
  if (process.env[name]) return process.env[name];
  for (const f of [".env.local", ".env"]) {
    const path = join(root, f);
    if (!existsSync(path)) continue;
    const m = readFileSync(path, "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return undefined;
}

let genAssets = null;
if (!apiKey) {
  const tokenFile = join(homedir(), ".gen-assets-token");
  const token = process.env.GEN_ASSETS_TOKEN || (existsSync(tokenFile) ? readFileSync(tokenFile, "utf8").trim() : "");
  const url = dotenv("VITE_SUPABASE_URL");
  const anon = dotenv("VITE_SUPABASE_ANON_KEY");
  if (!token || !url || !anon) {
    console.error("XAI_API_KEY is not set and the gen-assets fallback isn't configured (token / VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). Nothing was generated; the app falls back to English.");
    process.exit(1);
  }
  genAssets = { endpoint: `${url.replace(/\/$/, "")}/functions/v1/gen-assets`, token, anon };
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

// gen-assets has its own short system prompt, so the language description carries the app-specific rules.
const GLOSSARY =
  'Notes: "I\'m in" means "count me in" (voting for a plan). "Lobby" is the waiting room before planning. A "hard no" is something a person refuses to do. ' +
  "Keys ending in _one / _other are singular / plural forms. Keep straight double quotes around {placeholders}. Short labels that fit a phone button.";

async function genAssetsCall(lang, strings) {
  const res = await fetch(genAssets.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: genAssets.anon, "x-gen-token": genAssets.token },
    body: JSON.stringify({ action: "translate", lang: `${LANGUAGES[lang]}. ${GLOSSARY}`, strings }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`${lang}: gen-assets error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json())?.translations ?? {};
}

function existing(lang) {
  const path = join(i18nDir, `${lang}.json`);
  if (!ONLY_MISSING || !existsSync(path)) return {};
  const old = JSON.parse(readFileSync(path, "utf8"));
  // Keep only keys that still exist in en.json and still have the right placeholders.
  return Object.fromEntries(keys.filter((k) => typeof old[k] === "string" && old[k].trim() && placeholders(old[k]) === placeholders(en[k])).map((k) => [k, old[k]]));
}

async function translateViaGenAssets(lang) {
  const out = existing(lang);
  let todo = Object.fromEntries(keys.filter((k) => !(k in out)).map((k) => [k, en[k]]));
  if (Object.keys(todo).length === 0) {
    console.log(`${lang}: nothing missing`);
    return;
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const got = await genAssetsCall(lang, todo);
    for (const k of Object.keys(todo)) if (typeof got[k] === "string") out[k] = got[k];
    const errs = problems(out);
    if (errs.length === 0) {
      const ordered = Object.fromEntries(keys.map((k) => [k, out[k]]));
      writeFileSync(join(i18nDir, `${lang}.json`), JSON.stringify(ordered, null, 2) + "\n");
      console.log(`${lang}: ${Object.keys(todo).length} translated, ${keys.length} total -> src/i18n/${lang}.json via gen-assets (attempt ${attempt})`);
      return;
    }
    console.warn(`${lang}: attempt ${attempt} had ${errs.length} problem(s): ${errs.slice(0, 5).join("; ")}`);
    // Retry only the keys that are missing or lost a placeholder.
    const bad = keys.filter((k) => typeof out[k] !== "string" || !out[k].trim() || placeholders(out[k]) !== placeholders(en[k]));
    for (const k of bad) delete out[k];
    todo = Object.fromEntries(bad.map((k) => [k, en[k]]));
  }
  throw new Error(`${lang}: still invalid after 3 attempts`);
}

async function translate(lang) {
  if (genAssets) return translateViaGenAssets(lang);
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
      const keep = existing(lang);
      const ordered = Object.fromEntries(keys.map((k) => [k, keep[k] ?? out[k]]));
      writeFileSync(join(i18nDir, `${lang}.json`), JSON.stringify(ordered, null, 2) + "\n");
      console.log(`${lang}: ${keys.length} strings -> src/i18n/${lang}.json (attempt ${attempt})`);
      return;
    }
    console.warn(`${lang}: attempt ${attempt} had ${errs.length} problem(s): ${errs.slice(0, 5).join("; ")}`);
    messages.push({ role: "assistant", content }, { role: "user", content: `Fix these problems and return the full JSON object: ${errs.slice(0, 30).join("; ")}` });
  }
  throw new Error(`${lang}: still invalid after 3 attempts`);
}

const wanted = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const langs = wanted.length ? wanted : Object.keys(LANGUAGES);
for (const l of langs) if (!(l in LANGUAGES)) throw new Error(`Unknown language "${l}". Known: ${Object.keys(LANGUAGES).join(" ")}`);
console.log(`Translating ${keys.length} strings into ${langs.join(", ")} ${genAssets ? "via the gen-assets function (no XAI_API_KEY)" : `with ${model}`}…`);
const results = await Promise.allSettled(langs.map(translate));
const failed = results.map((r, i) => r.status === "rejected" && `${langs[i]}: ${r.reason?.message ?? r.reason}`).filter(Boolean);
if (failed.length) {
  console.error(`Failed:\n${failed.join("\n")}`);
  process.exit(1);
}
