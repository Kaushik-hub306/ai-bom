import { describe, it, expect } from "vitest";
import { scanContent, summarize, isUnpinnedModel } from "./scan";

describe("scanContent", () => {
  it("confirms an OpenAI call site with an extracted model", () => {
    const src = [
      `import OpenAI from "openai";`,
      `const client = new OpenAI();`,
      `const res = await client.chat.completions.create({`,
      `  model: "gpt-4o-2024-08-06",`,
      `  messages,`,
      `});`,
    ].join("\n");
    const sites = scanContent("src/agent.ts", src);
    expect(sites).toHaveLength(1);
    expect(sites[0]?.provider).toBe("openai");
    expect(sites[0]?.confidence).toBe("confirmed");
    expect(sites[0]?.model).toBe("gpt-4o-2024-08-06");
    expect(sites[0]?.line).toBe(3);
  });

  it("flags an unpinned alias", () => {
    const src = [
      `import Anthropic from "@anthropic-ai/sdk";`,
      `await client.messages.create({ model: "claude-latest" });`,
    ].join("\n");
    const sites = scanContent("a.ts", src);
    expect(sites[0]?.provider).toBe("anthropic");
    expect(sites[0]?.flags).toContain("unpinned_alias");
  });

  it("flags a hardcoded key WITHOUT leaking its value", () => {
    const secret = `"sk-abcdef0123456789ABCDEF"`;
    const src = [
      `import OpenAI from "openai";`,
      `const client = new OpenAI({ apiKey: ${secret} });`,
      `await client.responses.create({ model: "gpt-4.1" });`,
    ].join("\n");
    const sites = scanContent("a.ts", src);
    const serialized = JSON.stringify(sites);
    expect(sites.some((s) => s.flags.includes("hardcoded_key"))).toBe(true);
    expect(serialized).not.toContain("sk-abcdef");
  });

  it("marks a call 'possible' when no known SDK import is present", () => {
    const src = `const r = await thing.messages.create({ model: "x1" });`;
    const sites = scanContent("a.ts", src);
    expect(sites[0]?.confidence).toBe("possible");
    expect(sites[0]?.provider).toBe("unknown");
  });

  it("marks a call 'probable' when the SDK is imported but no model literal is found", () => {
    const src = [
      `import OpenAI from "openai";`,
      `await client.chat.completions.create(opts);`,
    ].join("\n");
    expect(scanContent("a.ts", src)[0]?.confidence).toBe("probable");
  });

  it("detects Python google-generativeai call sites", () => {
    const src = [
      `from google.generativeai import GenerativeModel  # @google/generative-ai`,
      `resp = model.generateContent(prompt)`,
    ].join("\n");
    // The import line references the google sdk marker.
    const sites = scanContent("m.py", src.replace("google.generativeai", "@google/generative-ai"));
    expect(sites[0]?.provider).toBe("google");
  });
});

describe("isUnpinnedModel", () => {
  it("treats *-latest and digit-free ids as unpinned", () => {
    expect(isUnpinnedModel("gpt-4o-latest")).toBe(true);
    expect(isUnpinnedModel("claude-sonnet")).toBe(true);
  });
  it("treats dated / versioned ids as pinned", () => {
    expect(isUnpinnedModel("gpt-4o-2024-08-06")).toBe(false);
    expect(isUnpinnedModel("claude-3-5-sonnet-20241022")).toBe(false);
  });
});

describe("summarize", () => {
  it("aggregates providers and flag counts", () => {
    const sites = scanContent(
      "a.ts",
      [
        `import OpenAI from "openai";`,
        `await c.chat.completions.create({ model: "gpt-4o-latest" });`,
      ].join("\n"),
    );
    const s = summarize(1, sites);
    expect(s.callSites).toBe(1);
    expect(s.unpinnedModels).toBe(1);
    expect(s.providers.openai).toBe(1);
  });
});
