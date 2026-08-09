import type { Env } from "../env";

/**
 * Model wrapper. gpt-oss models on Workers AI speak the OpenAI Responses
 * shape ({instructions, input} -> {output: [...]}); most other text models
 * speak {messages} -> {response}. extractText() tolerates both, so swapping
 * models in blog.config.ts doesn't require code changes.
 */
export async function runModel(
  env: Env,
  model: string,
  opts: { system?: string; prompt: string; maxTokens?: number },
): Promise<string> {
  const ai = env.AI as unknown as { run: (m: string, i: unknown) => Promise<unknown> };
  const input = model.includes("gpt-oss")
    ? { instructions: opts.system, input: opts.prompt }
    : {
        messages: [
          ...(opts.system ? [{ role: "system", content: opts.system }] : []),
          { role: "user", content: opts.prompt },
        ],
        max_tokens: opts.maxTokens ?? 4096,
      };
  const res = await ai.run(model, input);
  return extractText(res);
}

function extractText(res: unknown): string {
  if (typeof res === "string") return res;
  const r = res as Record<string, unknown>;
  if (!r) throw new Error("Empty AI response");
  if (typeof r.response === "string") return r.response;
  if (typeof r.output_text === "string") return r.output_text;
  if (Array.isArray(r.output)) {
    const texts: string[] = [];
    for (const item of r.output as Array<Record<string, unknown>>) {
      if (item?.type === "message" && Array.isArray(item.content)) {
        for (const c of item.content as Array<Record<string, unknown>>) {
          if (typeof c?.text === "string") texts.push(c.text);
        }
      }
    }
    if (texts.length) return texts.join("\n");
  }
  if (r.result) return extractText(r.result);
  throw new Error(
    "Unrecognized AI response shape: " + JSON.stringify(res).slice(0, 400),
  );
}

/** Parse the first JSON object out of possibly-chatty model output. */
export function extractJson<T>(text: string): T {
  const cleaned = text.replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("No JSON object found in model output: " + text.slice(0, 200));
  }
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

export async function embed(env: Env, model: string, text: string): Promise<number[]> {
  const ai = env.AI as unknown as { run: (m: string, i: unknown) => Promise<unknown> };
  const res = (await ai.run(model, { text: [text.slice(0, 2000)] })) as {
    data?: number[][];
  };
  const vector = res?.data?.[0];
  if (!Array.isArray(vector)) throw new Error("Embedding model returned no vector");
  return vector;
}

/** Fill {{PLACEHOLDER}} slots in a prompt template. */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    key in vars ? vars[key] : `{{${key}}}`,
  );
}
