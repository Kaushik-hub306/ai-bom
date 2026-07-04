# SPEC — AI-BOM

**A software bill of materials for AI: scan any codebase and get a complete, evidence-linked inventory of every model call, prompt, provider dependency, and cost exposure — plus an EU-AI-Act-oriented transparency report.**
Repo: `ai-bom` · License: MIT · Track: Both (B2B wedge + forward-thinking portfolio) · Target: 4–6 weeks

---

## 0. Mission & Positioning

Teams no longer know what AI they're running: model calls scattered across services, prompts inlined in code, aliases like `latest` that repriced or changed behavior overnight, keys with unknown blast radius. 29% of enterprises say they can't understand their own AI costs; the EU AI Act's transparency obligations are phasing in through 2026–27. There is no `npm audit` for AI usage.

Positioning: **"You have an SBOM for your dependencies. AI-BOM is the same rigor for your AI: every model call, every prompt, every provider — inventoried, diffed in CI, and export-ready for compliance."**

**Principles:**
1. **Precision over recall.** A false "you call GPT here" kills trust instantly. Every finding carries file:line evidence + a confidence tier; sub-threshold findings ship as "possible" not "detected."
2. **Static-only, zero-execution, zero-network by default.** Safe to run on any repo, in any CI, on day one. (`--prices-refresh` is the single opt-in network call.)
3. **The JSON is the product.** `aibom.json` is a versioned, documented schema others can build on; HTML/Markdown reports are views over it.

## 1. Scope

### P0
- **CLI:** `aibom scan [path]` → `aibom.json` + terminal summary; `aibom report` → self-contained HTML; `aibom diff old.json new.json` → what changed; `aibom check` → policy gate (exit non-zero on violations).
- **Detection targets (TS/JS + Python first):**
  - **SDK call sites:** openai, anthropic, google-genai, mistral, cohere, groq, bedrock, azure-openai, vertex, litellm, langchain, llamaindex, vercel ai-sdk, raw HTTP to known provider endpoints.
  - **Models:** literal model ids, config-sourced ids (best-effort dataflow within file), alias risk flags (`latest`, undated ids, env-injected).
  - **Prompts:** template literals/f-strings at call sites, prompt files (`.prompt`, `.txt`, `.md` in prompt-ish dirs), system-prompt assignments; extracted with heuristic classification (system/user/template) + snippet capture (truncated, redact-aware).
  - **Keys/config:** expected env vars per SDK, `.env.example` cross-check, hardcoded-key detection (report as CRITICAL, never print the value).
  - **Risk flags:** unpinned aliases, no timeout/retry wrapper, no output validation near JSON-mode calls, streaming without abort handling, PII-adjacent prompt heuristics (names/emails/health terms in templates), embedded-secrets.
- **Cost surface estimation:** call sites × model price table (bundled JSON, versioned, refreshable) → per-site $/1K-invocations and "if this runs N times/day" scenarios. Clearly labeled *estimation*, with assumptions printed.
- **Reports:** HTML (single file, beautiful, shareable), Markdown summary (PR-comment sized), and **EU-AI-Act orientation section**: maps findings to transparency/documentation obligation themes (provider/deployer role hints, GPAI usage disclosure checklist) with the disclaimer: *compliance-support tooling, not legal advice* — reviewed wording, shown in every report footer.
- **GitHub Action:** `ai-bom/action` — scan on PR, comment the diff ("+2 model call sites, +1 unpinned alias, est. +$X/mo at current volume"), optional `check` gate with policy file (`aibom.policy.yaml`: e.g. `forbid: hardcoded_keys, unpinned_aliases; require: timeout_wrappers`).

### P1
Go/Java/Ruby scanners, org dashboard (hosted, $99/mo: BOM over time, multi-repo rollup, alerting on drift), CycloneDX ML-extension export, SARIF output for code-scanning UIs.

### Out of scope (v1)
Runtime/proxy observation (that's Circuit's turf), model quality evals, secret *scanning* beyond AI-key patterns (defer to gitleaks; don't rebuild).

## 2. Architecture

```
packages/
  core/          # scan orchestrator, finding model, confidence scoring
  parsers/       # tree-sitter grammars: typescript, tsx, javascript, python
  rules/         # per-SDK rule packs (DATA: declarative matchers, YAML) + rule engine
  prices/        # bundled price table JSON + refresh script + versioning
  report-html/   # single-file HTML renderer (inlined CSS/JS, no CDN)
  report-md/     # PR-comment renderer
  schema/        # aibom.json JSON-schema v0.1 + TS types (published)
  cli/
action/          # GitHub Action (thin wrapper over CLI)
fixtures/        # labeled mini-repos per SDK + 3 vendored real OSS repo snapshots with hand-labeled ground truth
docs/            # rule reference, schema docs, policy reference, adr/
```

- **Rule packs are data, not code:** each SDK pack declares import patterns, call-shape queries (tree-sitter queries), model-argument extraction paths, env-var expectations, version ranges. Adding an SDK = adding YAML + fixtures, no engine changes. This is what keeps 15+ SDKs maintainable solo.
- **Confidence model:** `confirmed` (import + call shape + literal arg), `probable` (import + call shape), `possible` (pattern-only). Reports and `check` gates operate on confirmed/probable by default.
- **Monorepo-aware:** respects `.gitignore`, detects workspaces, scans vendored code only with `--include-vendored`.
- **Performance budget:** 100k-LOC repo in <30s on a laptop (parallel file parsing, grammar reuse).

### aibom.json v0.1 (sketch)
```json
{
  "aibom_version": "0.1", "generated_at": "...", "repo": {"root": "...", "commit": "..."},
  "call_sites": [{"id": "...", "file": "src/agent.ts", "line": 42, "sdk": "anthropic",
    "method": "messages.create", "models": [{"id": "claude-opus-4-8", "source": "literal", "pinned": true}],
    "prompt_refs": ["p_003"], "confidence": "confirmed", "flags": ["no_timeout"]}],
  "prompts": [{"id": "p_003", "kind": "system", "file": "...", "line": 12, "snippet_sha": "...", "chars": 1840}],
  "providers": [{"name": "anthropic", "env_vars": ["ANTHROPIC_API_KEY"], "call_site_count": 7}],
  "cost_estimates": [...], "risk_flags": [...], "summary": {...}
}
```

## 3. Milestones & Acceptance

### M0 — Scaffold (days 1–2)
Monorepo, CI, tree-sitter toolchain building cross-platform (macOS/Linux CI matrix; prebuilt WASM grammars to dodge native-build hell — ADR), `make golden` = scan a fixture repo → validate output against schema + expected findings.
**Accept:** `aibom scan fixtures/mini-openai-ts` produces schema-valid JSON with the 3 known findings, in CI, on both platforms.

### M1 — TS/JS scanner + 6 core SDK packs (weeks 1–2)
openai, anthropic, google-genai, vercel ai-sdk, langchain-js, litellm-proxy-client patterns + raw-HTTP endpoint detection. Confidence scoring. Labeled fixtures per pack.
**Accept:** per-pack fixture precision/recall measured and committed to `docs/accuracy.md` — gate: **precision ≥0.95, recall ≥0.80 on confirmed+probable**; 2 vendored real-repo snapshots scanned with hand-verified counts matching within tolerance; findings all carry file:line + snippet.

### M2 — Python scanner + prompt/key/risk detection (week 3)
Python packs (openai, anthropic, langchain, llamaindex); prompt extraction + classification; env-var/key checks; risk-flag rules.
**Accept:** same accuracy gates for Python packs; hardcoded-key fixture detected and value never appears in any output (redaction test); prompt snippets truncated + redacted per config.

### M3 — Cost estimation + reports (week 4)
Price table + estimator with printed assumptions; HTML report (single file, gorgeous: summary tiles, call-site table with code peeks, provider map, risk section, EU-AI-Act orientation section w/ reviewed disclaimer); Markdown PR summary.
**Accept:** HTML report opens offline, <1.5MB, renders 500 findings smoothly; estimates change correctly when price table version changes; disclaimer present in every rendered footer; a designer-eye pass (this report gets screenshotted — it's marketing).

### M4 — Diff, policy gate, GitHub Action (week 5)
`aibom diff` (added/removed/changed call sites, cost delta), `aibom check` + `aibom.policy.yaml`, Action with PR comment (sticky, updates in place).
**Accept:** Action runs on this repo itself in CI; policy violations exit non-zero with human-readable reasons; PR comment fixture-tested; diff stable under file moves (content-hash identity, not just path).

### M5 — Launch (week 6)
Scan 20 popular OSS agent/AI repos (respecting licenses); publish "The State of AI Dependencies in Popular Repos" post (X% unpinned aliases, Y% no timeouts, Z hardcoded-key incidents responsibly disclosed first); `npx ai-bom` polish; docs site; Show HN.
**Accept:** findings post drafted with every stat reproducible from committed scan artifacts; responsible-disclosure done for anything sensitive BEFORE publishing; quickstart <2 min (`npx ai-bom scan .`).

## 4. Quality Bar

- **Accuracy is versioned:** `docs/accuracy.md` regenerated by CI from labeled fixtures every release; regressions fail the build. Publish the numbers in the README (radical transparency = the moat).
- **Zero-harm scanning:** read-only, no network default, no telemetry, secrets never echoed; safe on hostile repos (parser crash isolation per file — one bad file never kills a scan).
- **Determinism:** same repo + same version → byte-identical `aibom.json` (stable ordering, no timestamps in body — `generated_at` only in envelope).
- **Compat:** Node 22+, npx-runnable, no global native deps (WASM grammars).

## 5. Interlock & Monetization

- Brand-adjacent to the trust suite; shares the launch audience. Circuit (if built later) is the runtime complement — AI-BOM finds call sites statically, Circuit meters them live; the `aibom.json` call-site ids are designed to be joinable with runtime attribution.
- Free CLI + Action forever. Hosted org dashboard ($99/mo) only after ≥1,000 CLI installs and ≥3 inbound "can we get this across 40 repos?" asks.

## 6. Prompting Opus 4.8 for this repo

- "Rule packs are YAML data + fixtures. If you're writing SDK-specific TypeScript in the engine, stop and write an ADR."
- "Every new detection rule lands with: fixture (positive), fixture (negative/trap), and an accuracy table update."
- "Never print secret values — test for this. Redaction failures are release blockers."
- "The HTML report is a marketing asset: design it like it will be screenshotted, because it will."
