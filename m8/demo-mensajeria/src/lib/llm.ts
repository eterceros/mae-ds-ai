// Cliente OpenAI apuntando al LLM local de Docker Model Runner.
// Compose inyecta LLM_URL (p. ej. http://model-runner.docker.internal/engines/v1/) y LLM_MODEL (ai/smollm2).
// No hace falta clave: Model Runner no la pide; el SDK exige un valor, así que va uno de relleno.
import OpenAI from 'openai';

const baseURL = process.env.LLM_URL ?? 'http://127.0.0.1:12434/engines/v1/';
export const LLM_MODEL = process.env.LLM_MODEL ?? 'ai/smollm2';
export const llm = new OpenAI({ baseURL, apiKey: 'no-hace-falta', maxRetries: 0 });

// Resumen en una frase. `timeoutMs` es el plazo TOTAL de la llamada (AbortSignal.timeout).
export async function summarize(text: string, timeoutMs: number): Promise<string> {
  const r = await llm.chat.completions.create({
    model: LLM_MODEL,
    max_tokens: 48,
    temperature: 0,
    messages: [{ role: 'user', content: `Summarize in one short sentence: ${text}` }],
  }, { signal: AbortSignal.timeout(timeoutMs) });
  return r.choices[0]?.message?.content ?? '';
}
