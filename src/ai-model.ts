/**
 * AI model abstraction with fallback chain.
 *
 * Tries providers in order until one succeeds:
 * 1. Gemini (if config.ai.geminiApiKey is set)
 * 2. OpenAI (if config.ai.openaiApiKey is set)
 * 3. Claude on Vertex AI (if CLAUDE_CODE_USE_VERTEX=1)
 * 4. Claude direct API (if config.ai.anthropicApiKey is set)
 */

import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import {
  getAIConfig,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_CLAUDE_VERTEX_MODEL,
  DEFAULT_CLAUDE_DIRECT_MODEL,
} from './config';

export let lastModelUsed = '';

const CALL_TIMEOUT_MS = 180000;
const MAX_ATTEMPTS = 3;

function withTimeout<T>(promise: Promise<T>, ms: number, name: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} timed out after ${ms / 1000}s`)), ms);
    promise.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); },
    );
  });
}

async function callWithRetry(fn: () => Promise<string>, name: string, maxAttempts = MAX_ATTEMPTS): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await withTimeout(fn(), CALL_TIMEOUT_MS, name);
    } catch (err: any) {
      const status = err?.status || err?.cause?.status;
      const retryable = [429, 500, 503, 529].includes(status);
      const isLast = attempt === maxAttempts - 1;

      if (retryable && !isLast) {
        const delay = Math.min(2000 * Math.pow(2, attempt), 10000);
        console.log(`  ${name}: retrying in ${delay / 1000}s (${status})...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`${name}: max retries exceeded`);
}

export async function callModel(prompt: string): Promise<string> {
  const ai = getAIConfig();
  const errors: string[] = [];

  const geminiModel = ai.models?.gemini || DEFAULT_GEMINI_MODEL;
  const openaiModel = ai.models?.openai || DEFAULT_OPENAI_MODEL;
  const claudeDirectModel = ai.models?.claude || DEFAULT_CLAUDE_DIRECT_MODEL;
  const claudeVertexModel = ai.models?.claude || DEFAULT_CLAUDE_VERTEX_MODEL;

  // --- Provider 1: OpenAI ---
  if (ai.openaiApiKey) {
    try {
      return await callWithRetry(async () => {
        const openai = createOpenAI({ apiKey: ai.openaiApiKey! });
        const { text } = await generateText({
          // Use the Responses API (correct max_output_tokens handling for gpt-5.x
          // reasoning models; the chat path sends the rejected 'max_tokens').
          model: openai.responses(openaiModel),
          prompt,
          maxOutputTokens: 32768,
          // 'low' is accepted by both gpt-5 and gpt-5.5 (gpt-5.5 dropped 'minimal').
          providerOptions: { openai: { reasoningEffort: 'low' } },
        });
        lastModelUsed = `OpenAI ${openaiModel}`;
        return text;
      }, 'OpenAI');
    } catch (err: any) {
      errors.push(`OpenAI: ${err.message?.substring(0, 100)}`);
      console.warn(`  ⚠ OpenAI failed, trying next provider...`);
    }
  }

  // --- Provider 2: Gemini ---
  if (ai.geminiApiKey) {
    try {
      return await callWithRetry(async () => {
        const google = createGoogleGenerativeAI({ apiKey: ai.geminiApiKey! });
        const { text } = await generateText({
          model: google(geminiModel),
          prompt,
          maxOutputTokens: 32768,
        });
        lastModelUsed = `Gemini ${geminiModel}`;
        return text;
      }, 'Gemini');
    } catch (err: any) {
      errors.push(`Gemini: ${err.message?.substring(0, 100)}`);
      console.warn(`  ⚠ Gemini failed, trying next provider...`);
    }
  }

  // --- Provider 3: Claude on Vertex AI ---
  if (process.env.CLAUDE_CODE_USE_VERTEX === '1') {
    try {
      return await callWithRetry(async () => {
        const client = new AnthropicVertex({
          projectId: process.env.ANTHROPIC_VERTEX_PROJECT_ID!,
          region: process.env.CLOUD_ML_REGION || 'us-east5',
        });
        const response = await client.messages.create({
          model: claudeVertexModel,
          max_tokens: 16384,
          messages: [{ role: 'user', content: prompt }],
        });
        const block = response.content.find(b => b.type === 'text');
        lastModelUsed = `Claude ${claudeVertexModel} (Vertex)`;
        return block?.text || '';
      }, 'Claude Vertex');
    } catch (err: any) {
      errors.push(`Claude Vertex: ${err.message?.substring(0, 100)}`);
      console.warn(`  ⚠ Claude Vertex failed, trying next provider...`);
    }
  }

  // --- Provider 4: Claude direct API ---
  if (ai.anthropicApiKey) {
    try {
      return await callWithRetry(async () => {
        const anthropic = createAnthropic({ apiKey: ai.anthropicApiKey! });
        const { text } = await generateText({
          model: anthropic(claudeDirectModel),
          prompt,
          maxOutputTokens: 32768,
        });
        lastModelUsed = `Claude ${claudeDirectModel}`;
        return text;
      }, 'Claude Direct');
    } catch (err: any) {
      errors.push(`Claude Direct: ${err.message?.substring(0, 100)}`);
    }
  }

  throw new Error(`All models failed:\n${errors.join('\n')}`);
}
