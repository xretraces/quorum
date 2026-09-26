#!/usr/bin/env python3
"""Plan & Pay prompt tests: send sample group chats to xAI exactly the way
plan-and-pay/supabase/functions/make-plan/index.ts does, then check the output.

Mirrors the edge function:
  * SYSTEM_PROMPT / CATALOG_FILE / PLAN_SCHEMA are read from the kit's generated
    supabase/functions/_shared/{system-prompt,catalog,plan-schema}.ts (what index.ts imports)
  * schemaForRequest(): strip $schema/$id, catalog_id -> enum of catalog ids, drop its pattern
  * user payload {roster, catalog (same 11 fields), transcript[:20000]} sent as JSON.stringify
  * POST https://api.x.ai/v1/chat/completions, response_format json_schema strict, 90 s timeout
  * up to 2 attempts; attempt 2 appends the same "failed validation" user message (validateSchema port)
Python 3.8+ standard library only. Key: GROK_API_KEY or XAI_API_KEY env var (never printed).

  python3 run.py --dry-run                 # build + print request bodies, no key, no network
  python3 run.py                           # all chats/*.json with grok-4.7 (or $GROK_MODEL)
  python3 run.py --model grok-4.20-0309-non-reasoning --tag fast
  python3 run.py --prompt make-plan.v2.md --tag v2   # alternative prompt (.md with PROMPT markers)
  python3 run.py --kit /path/to/plan-and-pay chats/t1-veg-cap-nocar.json
"""
import argparse, copy, glob, json, os, re, ssl, sys, time, uuid, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
XAI_URL = "https://api.x.ai/v1/chat/completions"
DEFAULT_MODEL = "grok-4.7"  # same as index.ts DEFAULT_MODEL
CATALOG_FIELDS = ["id", "name", "category", "neighborhood", "price_per_person_cents", "veg_friendly",
                  "transit_friendly", "typical_hours", "duration_minutes", "transit_note", "dietary_note"]
TIMEOUT_S = 90  # AbortSignal.timeout(90_000)


def js_stringify(obj):  # JSON.stringify(obj): no spaces, non-ASCII left as-is
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


# ---------------------------------------------------------------- load the kit (generated .ts modules)
def _ts_value(path, name):
    src = open(path, encoding="utf-8").read()
    m = re.search(r"export const %s(?:\s*:[^=]+)?\s*=\s*([\s\S]*?)\s*(?:as const)?\s*;\s*$" % name, src)
    if not m:
        sys.exit("could not parse %s from %s" % (name, path))
    return json.loads(m.group(1))


def load_kit(kit):
    shared = os.path.join(kit, "supabase", "functions", "_shared")
    if not os.path.isdir(shared):
        sys.exit("kit not found: %s (pass --kit /path/to/plan-and-pay)" % kit)
    system = _ts_value(os.path.join(shared, "system-prompt.ts"), "SYSTEM_PROMPT")
    catalog_file = _ts_value(os.path.join(shared, "catalog.ts"), "CATALOG_FILE")
    plan_schema = _ts_value(os.path.join(shared, "plan-schema.ts"), "PLAN_SCHEMA")
    # warn if the generated files drifted from the canonical sources (scripts/sync-shared.sh not re-run)
    drift = []
    try:
        if json.load(open(os.path.join(kit, "data", "atlanta-activities.json"), encoding="utf-8")) != catalog_file:
            drift.append("catalog.ts != data/atlanta-activities.json")
        if json.load(open(os.path.join(kit, "schema", "plan.schema.json"), encoding="utf-8")) != plan_schema:
            drift.append("plan-schema.ts != schema/plan.schema.json")
        if prompt_from_md(os.path.join(kit, "prompts", "make-plan.md")) != system:
            drift.append("system-prompt.ts != prompts/make-plan.md")
    except (OSError, SystemExit, ValueError) as e:
        drift.append("could not compare canonical files: %s" % e)
    for d in drift:
        print("WARNING kit drift: %s (edge function uses the .ts; run scripts/sync-shared.sh)" % d, file=sys.stderr)
    return system, catalog_file["activities"], plan_schema


def prompt_from_md(path):  # same extraction as scripts/sync-shared.sh
    md = open(path, encoding="utf-8").read()
    m = re.search(r"<!-- PROMPT:START -->\n([\s\S]*?)\n<!-- PROMPT:END -->", md)
    if not m:
        sys.exit("prompt markers not found in " + path)
    return m.group(1)


def schema_for_request(schema, catalog_ids):  # logic.ts schemaForRequest
    s = copy.deepcopy(schema)
    s.pop("$schema", None)
    s.pop("$id", None)
    p = s["properties"]["plans"]["items"]["properties"]["items"]["items"]["properties"]["catalog_id"]
    p["enum"] = catalog_ids
    p.pop("pattern", None)
    return s


# ---------------------------------------------------------------- logic.ts validateSchema (port)
def _matches(t, v):
    if t == "null": return v is None
    if t == "array": return isinstance(v, list)
    if t == "object": return isinstance(v, dict)
    if t == "integer": return isinstance(v, int) and not isinstance(v, bool) or (isinstance(v, float) and v.is_integer())
    if t == "number": return isinstance(v, (int, float)) and not isinstance(v, bool)
    if t == "string": return isinstance(v, str)
    if t == "boolean": return isinstance(v, bool)
    return False


def validate_schema(schema, value, path="$"):
    errors = []
    types = schema.get("type")
    if types is not None:
        types = types if isinstance(types, list) else [types]
        if not any(_matches(t, value) for t in types):
            got = "null" if value is None else "array" if isinstance(value, list) else type(value).__name__
            return ["%s: expected %s, got %s" % (path, "|".join(types), got)]
    if isinstance(schema.get("enum"), list) and value not in schema["enum"]:
        errors.append("%s: not one of enum (%s)" % (path, js_stringify(value)))
    if isinstance(value, str):
        n = len(value.encode("utf-16-le")) // 2  # JS string length
        if isinstance(schema.get("minLength"), int) and n < schema["minLength"]: errors.append("%s: shorter than %s" % (path, schema["minLength"]))
        if isinstance(schema.get("maxLength"), int) and n > schema["maxLength"]: errors.append("%s: longer than %s" % (path, schema["maxLength"]))
        if isinstance(schema.get("pattern"), str) and not re.fullmatch(schema["pattern"], value): errors.append("%s: does not match pattern" % path)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]: errors.append("%s: below minimum %s" % (path, schema["minimum"]))
        if "maximum" in schema and value > schema["maximum"]: errors.append("%s: above maximum %s" % (path, schema["maximum"]))
    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]: errors.append("%s: fewer than %s items" % (path, schema["minItems"]))
        if "maxItems" in schema and len(value) > schema["maxItems"]: errors.append("%s: more than %s items" % (path, schema["maxItems"]))
        if isinstance(schema.get("items"), dict):
            for i, v in enumerate(value): errors += validate_schema(schema["items"], v, "%s[%d]" % (path, i))
    if isinstance(value, dict):
        props = schema.get("properties", {})
        for req in schema.get("required", []):
            if req not in value: errors.append("%s.%s: required" % (path, req))
        for k, v in value.items():
            if k in props: errors += validate_schema(props[k], v, "%s.%s" % (path, k))
            elif schema.get("additionalProperties") is False: errors.append("%s.%s: unexpected property" % (path, k))
    return errors


# ---------------------------------------------------------------- request (index.ts callGrok)
def build_user_payload(test, catalog):
    roster = [{"member_id": str(uuid.uuid5(uuid.NAMESPACE_DNS, "plan-and-pay/" + n)), "name": n,
               "confirmed_budget_cap_cents": None,  # cap_source != "member": Grok extracts caps from chat
               "dietary": "", "availability": "", "location": "", "transport": ""} for n in test["roster"]]
    return {"roster": roster,
            "catalog": [{k: c[k] for k in CATALOG_FIELDS if k in c} for c in catalog],  # JS drops undefined keys
            "transcript": test["transcript"][:20000]}


def build_body(model, system, user_payload, request_schema, last_errors=None):
    messages = [{"role": "system", "content": system}, {"role": "user", "content": js_stringify(user_payload)}]
    if last_errors:
        messages.append({"role": "user", "content": "Your previous output failed validation: %s. Return corrected JSON only."
                         % "; ".join(last_errors[:10])})
    return {"model": model, "messages": messages,
            "response_format": {"type": "json_schema",
                                "json_schema": {"name": "plan_and_pay", "schema": request_schema, "strict": True}}}


def _ssl_context():
    try:
        import certifi  # optional; helps python.org macOS installs without "Install Certificates.command"
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def post(api_key, body):
    req = urllib.request.Request(XAI_URL, data=js_stringify(body).encode("utf-8"), method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + api_key})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S, context=_ssl_context()) as r:
            return r.status, json.loads(r.read().decode("utf-8")), round(time.time() - t0, 2)
    except urllib.error.HTTPError as e:
        return e.code, {"error_body": e.read().decode("utf-8", "replace")[:2000]}, round(time.time() - t0, 2)
    except urllib.error.URLError as e:
        if "CERTIFICATE_VERIFY_FAILED" in str(e):
            sys.exit("SSL cert error. On macOS run '/Applications/Python 3.x/Install Certificates.command' or 'pip3 install certifi'.")
        return 0, {"error_body": str(e)}, round(time.time() - t0, 2)


def call_grok(api_key, model, system, user_payload, request_schema):
    attempts, last_errors = [], []
    for attempt in (1, 2):
        body = build_body(model, system, user_payload, request_schema, last_errors if attempt > 1 else None)
        status, data, secs = post(api_key, body)
        rec = {"attempt": attempt, "http_status": status, "latency_s": secs, "usage": data.get("usage"), "response": data}
        attempts.append(rec)
        if status != 200:
            return None, attempts, ["xAI API error %s: %s" % (status, str(data.get("error_body", ""))[:300])]
        content = (data.get("choices") or [{}])[0].get("message", {}).get("content")
        if not isinstance(content, str):
            return None, attempts, ["xAI response had no message content"]
        try:
            parsed = json.loads(content)
        except ValueError:
            last_errors = ["content was not valid JSON"]
            rec["schema_errors"] = last_errors
            continue
        last_errors = validate_schema(request_schema, parsed)
        rec["schema_errors"] = last_errors
        if not last_errors:
            return parsed, attempts, []
    return None, attempts, ["Grok output failed validation after retry: " + "; ".join(last_errors[:10])]


# ---------------------------------------------------------------- quality checks (beyond the schema)
def check_output(out, cat, test):
    probs = []
    members, cons = out.get("members", []), out.get("constraints", {})
    caps = {m["name"]: m["budget_cap_cents"] for m in members if m.get("budget_cap_cents") is not None}
    veg = any(re.search(r"vegetarian|vegan", " ".join(m.get("dietary", [])), re.I) for m in members)
    no_car = [m["name"] for m in members if m.get("transport") != "car"]
    ps = cons.get("party_size")
    if ps != len(test["roster"]): probs.append("party_size %s != %d" % (ps, len(test["roster"])))
    if len(members) != len(test["roster"]): probs.append("%d members extracted for roster of %d" % (len(members), len(test["roster"])))
    if caps and cons.get("max_per_person_cents") != min(caps.values()):
        probs.append("max_per_person_cents %s != lowest cap %s" % (cons.get("max_per_person_cents"), min(caps.values())))
    if no_car and not cons.get("needs_transit") and test.get("expect_needs_transit"):
        probs.append("needs_transit=false but not everyone has a car: %s" % no_car)
    any_fit = False
    for i, p in enumerate(out.get("plans", []), 1):
        tag = "plan%d '%s'" % (i, p.get("title"))
        ids = [it["catalog_id"] for it in p.get("items", [])]
        bad = [x for x in ids if x not in cat]
        if bad:
            probs.append("%s: non-catalog ids %s" % (tag, bad)); continue
        pp = sum(cat[x]["price_per_person_cents"] for x in ids)
        if p["per_person_cents"] != pp: probs.append("%s: per_person_cents %s != catalog sum %s" % (tag, p["per_person_cents"], pp))
        if p["total_cents"] != pp * (ps or 0): probs.append("%s: total_cents %s != %s x %s" % (tag, p["total_cents"], pp, ps))
        over = sorted(n for n, c in caps.items() if pp > c)
        if sorted(p.get("over_cap_member_names", [])) != over:
            probs.append("%s: over_cap_member_names %s, actual over-cap %s" % (tag, p.get("over_cap_member_names"), over))
        if over and p.get("fits_everyone"): probs.append("%s: fits_everyone=true but over cap: %s" % (tag, over))
        for mn in p.get("member_notes", []):
            if mn["name"] in caps and mn["within_budget"] != (pp <= caps[mn["name"]]):
                probs.append("%s: within_budget wrong for %s" % (tag, mn["name"]))
        if len(p.get("member_notes", [])) != len(members):
            probs.append("%s: %d member_notes for %d members" % (tag, len(p.get("member_notes", [])), len(members)))
        if veg:
            nv = [x for x in ids if cat[x]["category"] == "food" and not cat[x]["veg_friendly"]]
            if nv: probs.append("%s: non-veg-friendly food %s with a vegetarian present" % (tag, nv))
        if cons.get("needs_transit"):
            nt = [x for x in ids if not cat[x]["transit_friendly"]]
            if nt and not re.search(r"ride|drive|pick|carpool", js_stringify(p), re.I):
                probs.append("%s: non-transit items %s and no ride mentioned" % (tag, nt))
        if not over: any_fit = True
        p["_computed"] = {"per_person_cents": pp, "over_cap": over,
                          "items": [[x, cat[x]["price_per_person_cents"], it["start_time"]] for x, it in zip(ids, p["items"])]}
    if not any_fit and test.get("fit_possible", True):
        probs.append("no plan fits everyone's cap although the catalog allows it (free items exist)")
    return probs


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--kit", default=os.path.join(HERE, "..", ".."), help="path to the repo/kit root (default: this repo)")
    ap.add_argument("--model", default=os.environ.get("GROK_MODEL") or DEFAULT_MODEL)
    ap.add_argument("--prompt", help="use this .md (PROMPT:START/END markers) instead of the kit's system-prompt.ts")
    ap.add_argument("--tag", default="v1", help="label for output files")
    ap.add_argument("--out", default=os.path.join(HERE, "out"))
    ap.add_argument("--dry-run", action="store_true", help="print the request body per chat; no key, no network")
    ap.add_argument("chats", nargs="*", help="chat JSON files (default chats/*.json)")
    a = ap.parse_args()

    system, catalog, plan_schema = load_kit(os.path.abspath(a.kit))
    if a.prompt: system = prompt_from_md(a.prompt)
    cat = {c["id"]: c for c in catalog}
    request_schema = schema_for_request(plan_schema, [c["id"] for c in catalog])
    chats = a.chats or sorted(glob.glob(os.path.join(HERE, "chats", "*.json")))
    if not chats: sys.exit("no chat files found")

    if a.dry_run:
        for path in chats:
            test = json.load(open(path, encoding="utf-8"))
            body = build_body(a.model, system, build_user_payload(test, catalog), request_schema)
            print("### %s  (POST %s, %d bytes)" % (test["id"], XAI_URL, len(js_stringify(body).encode("utf-8"))))
            print(json.dumps(body, indent=2, ensure_ascii=False))
        return

    api_key = os.environ.get("GROK_API_KEY") or os.environ.get("XAI_API_KEY")
    if not api_key: sys.exit("GROK_API_KEY / XAI_API_KEY is not set in this process")
    os.makedirs(a.out, exist_ok=True)
    summary = []
    for path in chats:
        test = json.load(open(path, encoding="utf-8"))
        parsed, attempts, errs = call_grok(api_key, a.model, system, build_user_payload(test, catalog), request_schema)
        probs = errs + (check_output(parsed, cat, test) if parsed else [])
        secs = sum(x["latency_s"] for x in attempts)
        rec = {"test": test["id"], "expect": test.get("expect"), "model": a.model, "prompt": a.prompt or "kit system-prompt.ts",
               "attempts": attempts, "total_latency_s": round(secs, 2), "parsed": parsed, "problems": probs}
        fn = os.path.join(a.out, "%s.%s.%s.json" % (test["id"], a.tag, a.model))
        with open(fn, "w", encoding="utf-8") as f: json.dump(rec, f, indent=2, ensure_ascii=False)
        summary.append({"test": test["id"], "status": [x["http_status"] for x in attempts], "attempts": len(attempts),
                        "latency_s": [x["latency_s"] for x in attempts], "pass": not probs, "problems": probs})
        print("== %s [%s %s] HTTP %s, %d attempt(s), %.2fs -> %s" % (test["id"], a.model, a.tag,
              "/".join(str(x["http_status"]) for x in attempts), len(attempts), secs, "PASS" if not probs else "FAIL"))
        for p in probs: print("   -", p)
        for p in (parsed or {}).get("plans", []):
            print("   plan: %s | pp=%s fits=%s over=%s | %s" % (p["title"], p["per_person_cents"], p["fits_everyone"],
                  p["over_cap_member_names"], p.get("_computed", {}).get("items")))
        if parsed: print("   time_window:", parsed["constraints"]["time_window"])
    with open(os.path.join(a.out, "summary.%s.%s.json" % (a.tag, a.model)), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)


if __name__ == "__main__":
    main()
