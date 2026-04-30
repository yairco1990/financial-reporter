/**
 * Standalone test for OpenAI API.
 * Usage: npm run build && node build/test-openai.js
 */

import 'dotenv/config';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { syncFromState } from './state-sync';
import { getAIConfig, DEFAULT_OPENAI_MODEL } from './config';

async function main() {
  await syncFromState();
  const ai = getAIConfig();
  const apiKey = ai.openaiApiKey;
  const model = ai.models?.openai || DEFAULT_OPENAI_MODEL;

  if (!apiKey) {
    console.error('❌ ai.openaiApiKey not set in config.json');
    process.exit(1);
  }

  console.log(`Testing OpenAI model: ${model}`);
  console.log(`API key starts with: ${apiKey.substring(0, 12)}...`);

  try {
    const openai = createOpenAI({ apiKey });
    const start = Date.now();
    const { text } = await generateText({
      model: openai(model),
      prompt: 'Say hello in Hebrew in one short sentence.',
      maxOutputTokens: 100,
    });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`✓ Response (${elapsed}s):`);
    console.log(text);
  } catch (err: any) {
    console.error('❌ OpenAI call failed:');
    console.error('  Message:', err.message);
    console.error('  Status:', err.status || err?.cause?.status || 'N/A');
    process.exit(1);
  }
}

main();
