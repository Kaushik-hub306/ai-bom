/**
 * ai-bom M0 scanner.
 *
 * A dependency-free, static, zero-execution scanner that finds AI model call
 * sites in source text and records the provider, model, and risk flags. It is
 * deliberately precision-first: a call pattern with no known SDK import is
 * reported as "possible", not "confirmed".
 *
 * M1 replaces the line/regex heuristics with tree-sitter grammars and moves
 * per-SDK matchers into declarative YAML rule packs (see SPEC.md). The public
 * shape below (CallSite / ScanSummary) is the seed of the versioned
 * `aibom.json` schema and is intended to stay stable.
 *
 * Safety invariant: secret *values* are never stored or emitted — only a
 * `hardcoded_key` flag. Do not change this without a redaction test.
 */

export type Provider =
  | "openai"
  | "anthropic"
  | "google"
  | "mistral"
  | "cohere"
  | "unknown";

export type Confidence = "confirmed" | "probable" | "possible";

export interface CallSite {
  file: string;
  /** 1-based line number of the call. */
  line: number;
  sdk: string;
  provider: Provider;
  model?: string;
  confidence: Confidence;
  flags: string[];
}

export interface ScanSummary {
  files: number;
  callSites: number;
  unpinnedModels: number;
  hardcodedKeys: number;
  providers: Record<string, number>;
}

interface SdkRule {
  re: RegExp;
  sdk: string;
  provider: Provider;
}

const SDK_IMPORTS: SdkRule[] = [
  { re: /(from\s+['"]openai['"]|require\(\s*['"]openai['"]\s*\))/, sdk: "openai", provider: "openai" },
  { re: /@anthropic-ai\/sdk/, sdk: "@anthropic-ai/sdk", provider: "anthropic" },
  { re: /@google\/(generative-ai|genai)/, sdk: "@google/generative-ai", provider: "google" },
  { re: /(from\s+['"]@?mistralai(\/mistralai)?['"])/, sdk: "mistralai", provider: "mistral" },
  { re: /(from\s+['"]cohere-ai['"])/, sdk: "cohere-ai", provider: "cohere" },
];

const CALL_PATTERNS: RegExp[] = [
  /\.chat\.completions\.create\s*\(/,
  /\.responses\.create\s*\(/,
  /\.messages\.create\s*\(/,
  /\.generateContent\s*\(/,
  /\.complete\s*\(/,
];

const MODEL_RE = /model\s*[:=]\s*['"]([^'"]+)['"]/;
// Matches an OpenAI-style secret literal so we can FLAG it. The captured text
// is never stored — only the boolean result is used.
const KEY_RE = /['"](sk|sk-ant|sk-proj)-[A-Za-z0-9_-]{16,}['"]/;

/** True for model ids that pin nothing to a specific dated version. */
export function isUnpinnedModel(model: string): boolean {
  if (/latest/i.test(model)) return true;
  // No digits at all → almost certainly an alias (e.g. "claude-sonnet").
  return !/\d/.test(model);
}

/** Scan a single file's contents for AI call sites. Pure. */
export function scanContent(file: string, content: string): CallSite[] {
  const lines = content.split(/\r?\n/);
  const matchedSdks = SDK_IMPORTS.filter((s) => s.re.test(content));
  const primary = matchedSdks[0];

  // A hardcoded key is a file-level risk (it's often declared in a constructor
  // above the call sites it powers), so we detect it across the whole file and
  // attribute the flag to every call site in that file.
  const fileHasHardcodedKey = KEY_RE.test(content);

  const sites: CallSite[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!CALL_PATTERNS.some((re) => re.test(line))) continue;

    // Look at the call line plus a few following lines for the model arg.
    const windowText = lines.slice(i, i + 4).join("\n");
    const model = windowText.match(MODEL_RE)?.[1];

    const provider: Provider = primary ? primary.provider : "unknown";
    const sdk = primary ? primary.sdk : "unknown";
    const confidence: Confidence = primary ? (model ? "confirmed" : "probable") : "possible";

    const flags: string[] = [];
    if (model && isUnpinnedModel(model)) flags.push("unpinned_alias");
    if (fileHasHardcodedKey) flags.push("hardcoded_key");

    const site: CallSite = { file, line: i + 1, sdk, provider, confidence, flags };
    if (model) site.model = model;
    sites.push(site);
  }
  return sites;
}

/** Aggregate call sites from any number of files into a summary. */
export function summarize(fileCount: number, sites: readonly CallSite[]): ScanSummary {
  const providers: Record<string, number> = {};
  let unpinnedModels = 0;
  let hardcodedKeys = 0;
  for (const s of sites) {
    providers[s.provider] = (providers[s.provider] ?? 0) + 1;
    if (s.flags.includes("unpinned_alias")) unpinnedModels++;
    if (s.flags.includes("hardcoded_key")) hardcodedKeys++;
  }
  return { files: fileCount, callSites: sites.length, unpinnedModels, hardcodedKeys, providers };
}
