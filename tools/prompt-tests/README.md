# Plan & Pay prompt tests

`run.py` sends the sample chats in `chats/` to xAI with the same request body that
`plan-and-pay/supabase/functions/make-plan/index.ts` builds. It uses the system prompt, catalog and schema
from `_shared/*.ts`, the same `schemaForRequest` changes, the same user payload and `response_format`, a 90 s timeout
and the kit's one retry. It then checks the output: schema, catalog ids only, cost math, cap flags,
vegetarian food and transit. Uses only the Python 3.8+ standard library.

In this repo `--kit` defaults to the repo root (`../..`), so no flag is needed.

    cd tools/prompt-tests
    python3 run.py --dry-run                     # prints request bodies; no key, no network
    export GROK_API_KEY=...                      # or XAI_API_KEY
    python3 run.py                               # grok-4.7 (kit default; or $GROK_MODEL)
    python3 run.py --model grok-4.20-0309-non-reasoning --tag fast
    python3 run.py --prompt make-plan.v2.md --tag v2    # try an alternative prompt (.md with PROMPT markers)

Results go to `out/<test>.<tag>.<model>.json` (raw responses, latency, token usage, problems) and
`out/summary.<tag>.<model>.json`. macOS SSL error: run "Install Certificates.command" from your
Python folder, or `pip3 install certifi`.
