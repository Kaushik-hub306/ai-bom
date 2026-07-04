# ai-bom 📋🤖

**A software bill of materials for AI.** `npx ai-bom scan .` walks a codebase and produces a complete, evidence-linked inventory of every model call, the providers behind them, and the risk flags that matter — unpinned model aliases, missing timeouts, and hardcoded keys — then writes it all to `aibom.json`.

> You have an SBOM for your dependencies. AI-BOM is the same rigor for your AI. Teams no longer know what models they're calling, from where, at what cost — and the EU AI Act's transparency obligations are phasing in. This makes your AI surface auditable.

---

## Status: `M0` — the scanner core

This repo ships a **real, dependency-free static scanner** (`src/scan.ts`) plus a thin CLI (`src/cli.ts`) and a full test suite. It detects call sites for OpenAI, Anthropic, Google, Mistral and Cohere SDKs across TS/JS/Python, extracts model ids, and flags risks.

M1 replaces the regex/line heuristics with **tree-sitter** grammars and moves per-SDK matchers into declarative **YAML rule packs**; M3 adds cost estimation and the HTML report; M4 adds the diff + policy gate + GitHub Action (see [`SPEC.md`](./SPEC.md)). The `CallSite` / `ScanSummary` shapes here are the seed of the versioned `aibom.json` schema.

## Quickstart

```bash
npm install
npm run typecheck
npm test            # scanner suite, incl. a redaction test (keys are never stored)

# build the CLI and scan a project
npm run build
node dist/cli.js /path/to/your/project
```

## What it finds

```jsonc
{
  "aibom_version": "0.1",
  "summary": { "files": 128, "callSites": 14, "unpinnedModels": 3, "hardcodedKeys": 0,
               "providers": { "openai": 9, "anthropic": 5 } },
  "call_sites": [
    { "file": "src/agent.ts", "line": 42, "sdk": "openai", "provider": "openai",
      "model": "gpt-4o-2024-08-06", "confidence": "confirmed", "flags": [] }
  ]
}
```

**Confidence tiers** keep it honest: `confirmed` (import + call + model literal), `probable` (import + call), `possible` (call pattern only, no known import).

## Design principles

1. **Precision over recall** — a false "you call GPT here" destroys trust; sub-threshold hits are `possible`, not `detected`.
2. **Static-only, zero-execution, zero-network** — safe to run on any repo, in any CI, from day one.
3. **The JSON is the product** — `aibom.json` is a versioned, documented schema; the HTML/Markdown reports are views over it.
4. **Never print secret values** — hardcoded keys are *flagged*, never stored. This is enforced by a test.

## License

MIT — see [`LICENSE`](./LICENSE). Part of the **Agent Trust Suite**. Not legal advice; the EU-AI-Act report section is compliance-*support* tooling.
