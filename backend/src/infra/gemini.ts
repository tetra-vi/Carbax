import { GoogleGenAI, FunctionCallingConfigMode, type Content, type Part, type Schema } from '@google/genai';
import type { LlmClient, LlmPart, ToolDeclaration, ToolLoopResult } from '../ports';

/**
 * Gemini on Vertex AI. Authentication uses the Cloud Run service account (Application Default
 * Credentials); no API key is stored in code or sent to the browser.
 */
export class GeminiClient implements LlmClient {
  private readonly ai: GoogleGenAI;
  constructor(
    project: string,
    location: string,
    public readonly model: string,
  ) {
    this.ai = new GoogleGenAI({ vertexai: true, project, location });
  }

  async generateJson<T>(req: { system: string; parts: LlmPart[]; schema: Record<string, unknown> }): Promise<T> {
    const res = await this.ai.models.generateContent({
      model: this.model,
      contents: [{ role: 'user', parts: req.parts as Part[] }],
      config: {
        systemInstruction: req.system,
        responseMimeType: 'application/json',
        responseSchema: req.schema as Schema,
        temperature: 0,
      },
    });
    const text = res.text;
    if (!text) throw new Error('Gemini returned an empty response');
    return JSON.parse(text) as T;
  }

  async generateText(req: { system: string; parts: LlmPart[] }): Promise<string> {
    const res = await this.ai.models.generateContent({
      model: this.model,
      contents: [{ role: 'user', parts: req.parts as Part[] }],
      config: { systemInstruction: req.system, temperature: 0.2 },
    });
    return (res.text ?? '').trim();
  }

  async runTools(req: {
    system: string;
    prompt: string;
    tools: ToolDeclaration[];
    maxSteps: number;
    execute: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  }): Promise<ToolLoopResult> {
    const contents: Content[] = [{ role: 'user', parts: [{ text: req.prompt }] }];
    const functionDeclarations = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parametersJsonSchema: t.parameters,
    }));
    for (let step = 1; step <= req.maxSteps; step++) {
      const res = await this.ai.models.generateContent({
        model: this.model,
        contents,
        config: {
          systemInstruction: req.system,
          temperature: 0,
          tools: [{ functionDeclarations }],
          toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
        },
      });
      const calls = res.functionCalls ?? [];
      if (calls.length === 0) return { finalText: res.text ?? null, steps: step };
      const modelContent = res.candidates?.[0]?.content;
      if (modelContent) contents.push(modelContent);
      const responses: Part[] = [];
      for (const call of calls) {
        let output: unknown;
        try {
          output = { output: await req.execute(call.name ?? '', (call.args ?? {}) as Record<string, unknown>) };
        } catch (e) {
          output = { error: (e as Error).message };
        }
        responses.push({ functionResponse: { id: call.id, name: call.name, response: output as Record<string, unknown> } });
      }
      contents.push({ role: 'user', parts: responses });
    }
    return { finalText: null, steps: req.maxSteps };
  }
}
