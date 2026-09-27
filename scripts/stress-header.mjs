// Stress-test QuorumHeader wiring against vite preview + live Supabase.
import fs from "fs";
import path from "path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");

const BASE = process.env.STRESS_BASE || "http://127.0.0.1:5179";
const OUT = path.resolve("stress-shots");
fs.mkdirSync(OUT, { recursive: true });

const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8").split(/\n/).filter((l) => l && !l.startsWith("#")).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1)];
  }),
);
const SB_URL = env.VITE_SUPABASE_URL;
const SB_KEY = env.VITE_SUPABASE_ANON_KEY;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

async function sb(pathname, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${pathname}`, {
    method,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: method === "POST" ? "return=representation" : "return=minimal",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${pathname} ${res.status}: ${text.slice(0, 200)}`);
  return data;
}

async function seedGroup() {
  const g = (await sb("groups", { method: "POST", body: { name: "Header stress " + Date.now() } }))[0];
  const m1 = (await sb("members", { method: "POST", body: { group_id: g.id, display_name: "Ada", is_organizer: true } }))[0];
  const m2 = (await sb("members", { method: "POST", body: { group_id: g.id, display_name: "Ben" } }))[0];
  const m3 = (await sb("members", { method: "POST", body: { group_id: g.id, display_name: "Cara" } }))[0];
  await sb(`members?id=eq.${m2.id}`, { method: "PATCH", body: { prefs_ready: true, budget_cap_cents: 4000 }, headers: { Prefer: "return=minimal" } });
  await sb(`members?id=eq.${m3.id}`, { method: "PATCH", body: { prefs_ready: true, budget_cap_cents: 5000 }, headers: { Prefer: "return=minimal" } });
  await sb(`members?id=eq.${m1.id}`, { method: "PATCH", body: { prefs_ready: true, budget_cap_cents: 3000 }, headers: { Prefer: "return=minimal" } });
  // insert a couple plans so plansReady fires
  const plans = await sb("plans", {
    method: "POST",
    body: [
      {
        group_id: g.id, option_index: 0, title: "Piedmont picnic", summary: "Park hang",
        items: [], per_person_cents: 1200, total_cents: 3600, fits_everyone: true,
        over_cap_member_ids: [], member_notes: [], why_it_works: "Cheap outdoor", reasoning: null, server_warnings: [],
      },
      {
        group_id: g.id, option_index: 1, title: "Krog Street bites", summary: "Food hall",
        items: [], per_person_cents: 2500, total_cents: 7500, fits_everyone: true,
        over_cap_member_ids: [], member_notes: [], why_it_works: "Food for all", reasoning: null, server_warnings: [],
      },
    ],
  });
  await sb(`groups?id=eq.${g.id}`, { method: "PATCH", body: { status: "voting" }, headers: { Prefer: "return=minimal" } });
  await sb(`members?id=eq.${m2.id}`, { method: "PATCH", body: { vote_plan_id: plans[0].id }, headers: { Prefer: "return=minimal" } });
  await sb(`members?id=eq.${m3.id}`, { method: "PATCH", body: { vote_plan_id: plans[0].id }, headers: { Prefer: "return=minimal" } });
  await sb(`groups?id=eq.${g.id}`, {
    method: "PATCH",
    body: { selected_plan_id: plans[0].id, status: "decided" },
    headers: { Prefer: "return=minimal" },
  });
  return { group: g, members: [m1, m2, m3], plans };
}

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, type: "jpeg", quality: 55, fullPage: false });
  return file;
}

async function main() {
  let seeded = null;
  try {
    seeded = await seedGroup();
    check("supabase seed 3-member group + plans + votes + winner", true, seeded.group.id);
  } catch (e) {
    check("supabase seed 3-member group + plans + votes + winner", false, String(e.message || e));
  }

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();

  try {
    await page.goto(BASE + "/", { waitUntil: "networkidle2", timeout: 30000 });
    await page.waitForSelector("text/quorum", { timeout: 10000 }).catch(() => {});
    // home header present
    const hasLang = await page.$("nav[aria-label]");
    check("home: util nav present", !!hasLang);
    await shot(page, "01-home-header.jpg");

    // info sheet
    const infoBtn = await page.$('button[aria-label*="How Quorum"], button[aria-label*="how Quorum"], button[aria-label="How Quorum works"]');
    if (infoBtn) {
      await infoBtn.click();
      await page.waitForSelector("#quorum-info-title", { timeout: 5000 });
      const title = await page.$eval("#quorum-info-title", (el) => el.textContent.trim());
      check("info sheet opens", /How Quorum works/i.test(title), title);
      await shot(page, "02-info-sheet.jpg");
      const gotIt = await page.evaluateHandle(() =>
        [...document.querySelectorAll("button")].find((b) => /Got it|فهمت|Entendido/i.test(b.textContent || ""))
      );
      if (gotIt) await gotIt.asElement()?.click();
      else await page.click('button[aria-label="Close"]');
      await new Promise((r) => setTimeout(r, 400));
      const closed = (await page.$("#quorum-info-title")) === null;
      check("info sheet closes", closed);
    } else {
      check("info sheet opens", false, "info button not found");
      check("info sheet closes", false, "skipped");
    }

    // language menu — native select inside LanguageMenu
    const select = await page.$("nav[aria-label] select");
    check("language select present in header", !!select);
    if (select) {
      // open-ish: change to Spanish then Arabic
      await page.select("nav[aria-label] select", "es");
      await new Promise((r) => setTimeout(r, 400));
      const shortEs = await page.$eval("nav[aria-label]", (nav) => nav.textContent);
      check("language switch to ES shows ES", /ES/i.test(shortEs), shortEs.replace(/\s+/g, " ").slice(0, 40));
      await shot(page, "03-language-menu-es.jpg");

      await page.select("nav[aria-label] select", "ar");
      await new Promise((r) => setTimeout(r, 500));
      const dir = await page.evaluate(() => document.documentElement.dir);
      const shortAr = await page.$eval("nav[aria-label]", (nav) => nav.textContent);
      check("Arabic RTL sets dir=rtl", dir === "rtl", `dir=${dir}`);
      check("language shortCode AR", /AR/i.test(shortAr), shortAr.replace(/\s+/g, " ").slice(0, 40));
      await shot(page, "04-arabic-rtl.jpg");

      await page.select("nav[aria-label] select", "en");
      await new Promise((r) => setTimeout(r, 300));
    }

    // bell on home (empty)
    const bell = await page.$('button[aria-label="Notifications"], button[aria-label*="Notification"]');
    check("bell button present on home", !!bell);
    if (bell) {
      await bell.click();
      await new Promise((r) => setTimeout(r, 300));
      const dialog = await page.$('div[role="dialog"][aria-label]');
      const body = dialog ? await dialog.evaluate((el) => el.textContent) : "";
      check("bell empty state on home", /Open a group|Group updates|No updates|live updates|Notifications/i.test(body || ""), (body || "").slice(0, 100));
      await shot(page, "05-bell-home-empty.jpg");
      // click away
      await page.mouse.click(10, 200);
      await new Promise((r) => setTimeout(r, 200));
    }

    // 375px layout
    await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2 });
    await page.goto(BASE + "/", { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 400));
    const overlap = await page.evaluate(() => {
      const nav = document.querySelector("nav[aria-label]");
      const logo = document.querySelector(".font-logo");
      if (!nav || !logo) return "missing";
      const a = nav.getBoundingClientRect();
      const b = logo.getBoundingClientRect();
      const hit = !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
      return { hit, navW: a.width, logoW: b.width, vw: window.innerWidth };
    });
    check("375px: header nav does not overlap logo", overlap === "missing" ? false : !overlap.hit, JSON.stringify(overlap));
    await shot(page, "06-home-375.jpg");

    // group board with seeded group
    if (seeded) {
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
      // inject member id so notifications key correctly
      await page.goto(BASE + "/", { waitUntil: "networkidle2" });
      await page.evaluate((gid, mid) => {
        localStorage.setItem("pp:member:" + gid, mid);
        // clear notif read so badge shows
        Object.keys(localStorage).filter((k) => k.startsWith("pp:notif")).forEach((k) => localStorage.removeItem(k));
      }, seeded.group.id, seeded.members[0].id);
      await page.goto(BASE + "/g/" + seeded.group.id, { waitUntil: "networkidle2", timeout: 30000 });
      await new Promise((r) => setTimeout(r, 1500));
      const boardNav = await page.$("nav[aria-label]");
      check("group board: util nav present", !!boardNav);
      // wait for badge or open bell
      await new Promise((r) => setTimeout(r, 1000));
      const badgeText = await page.evaluate(() => {
        const btn = [...document.querySelectorAll("button")].find((b) => /notification/i.test(b.getAttribute("aria-label") || ""));
        if (!btn) return null;
        const badge = btn.querySelector("span");
        return badge ? badge.textContent.trim() : "0";
      });
      check("bell unread badge on group board", badgeText && badgeText !== "0", `badge=${badgeText}`);
      const bell2 = await page.$('button[aria-label="Notifications"], button[aria-label*="Notification"]');
      if (bell2) {
        await bell2.click();
        await new Promise((r) => setTimeout(r, 500));
        const listText = await page.evaluate(() => {
          const dialogs = [...document.querySelectorAll('[role="dialog"]')];
          const d = dialogs.find((el) => /joined|voted|Plans are ready|Winner|Everyone|finished|Group updates|Open a group/i.test(el.textContent || ""))
            || dialogs[dialogs.length - 1];
          return d ? d.textContent : "NO_DIALOG:" + dialogs.length;
        });
        console.log("BELL_LIST:", JSON.stringify(listText).slice(0, 300));
        const kinds = {
          joined: /joined/i.test(listText),
          ready: /finished their answers|answers/i.test(listText),
          allReady: /Everyone's ready|ready/i.test(listText),
          plansReady: /Plans are ready/i.test(listText),
          voted: /voted/i.test(listText),
          winner: /Winner picked/i.test(listText),
        };
        for (const [k, v] of Object.entries(kinds)) check(`bell event visible: ${k}`, v, listText.slice(0, 120));
        await shot(page, "07-bell-dropdown-items.jpg");
        // mark read / badge clears after open
        await page.mouse.click(10, 200);
        await new Promise((r) => setTimeout(r, 300));
        await bell2.click();
        await new Promise((r) => setTimeout(r, 300));
        await page.mouse.click(10, 200);
        await new Promise((r) => setTimeout(r, 200));
        const badgeAfter = await page.evaluate(() => {
          const btn = [...document.querySelectorAll("button")].find((b) => /notification/i.test(b.getAttribute("aria-label") || ""));
          if (!btn) return null;
          const badge = btn.querySelector("span.rounded-full, span[class*='sun']");
          // our badge has bg-sun
          const spans = [...btn.querySelectorAll("span")];
          const b = spans.find((s) => /bg-sun|sun/.test(s.className) || /^\d/.test(s.textContent || ""));
          return b ? b.textContent.trim() : "0";
        });
        check("badge clears after open (markRead)", !badgeAfter || badgeAfter === "0", `badge=${badgeAfter}`);
      } else {
        check("bell dropdown with items", false, "bell missing on board");
      }
      await shot(page, "08-group-board-header.jpg");
    }

    // no floating LanguageSwitcher
    const floating = await page.evaluate(() => {
      const fixed = [...document.querySelectorAll(".fixed")].filter((el) => /EN|ES|AR|Language/i.test(el.textContent || ""));
      return fixed.length;
    });
    check("no separate floating LanguageSwitcher", floating === 0, `fixedLangish=${floating}`);

  } catch (e) {
    check("stress runner", false, String(e.stack || e));
  } finally {
    await browser.close();
  }

  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  const report = { pass, fail, results, shots: fs.readdirSync(OUT), groupId: seeded?.group?.id ?? null };
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log("\n=== SUMMARY ===");
  console.log(`pass=${pass} fail=${fail}`);
  console.log("shots:", report.shots.join(", "));
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
