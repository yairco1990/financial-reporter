/**
 * Split payment processor — extracts shared expense data from Bit/PayBox screenshots.
 *
 * Workflow:
 * 1. User uploads payment app screenshots to a Google Drive folder
 *    (configured via SPLITS_INBOX_FOLDER_ID, shared read+delete with the SA)
 * 2. This module lists the images via Drive API
 * 3. Gemini Vision analyzes each screenshot for structured data
 * 4. Results saved as JSON in the local state cache (gets pushed to state repo)
 * 5. Processed images deleted from the Drive inbox
 *
 * Splits are entirely optional. If SPLITS_INBOX_FOLDER_ID and a service
 * account aren't configured, this step is skipped.
 */

import * as fs from 'fs';
import * as path from 'path';
import { generateText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { SplitRecord } from '../types';
import { DATA_DIR, DEFAULT_GEMINI_MODEL, getAIConfig } from '../config';
import { listSplitsInbox, fetchFileBuffer, deleteFile, getSplitsInboxFolderId } from '../drive';

const SPLITS_DIR = path.join(DATA_DIR, 'splits');

export async function processSplits(): Promise<void> {
  if (!getSplitsInboxFolderId()) {
    console.log('No SPLITS_INBOX_FOLDER_ID configured, skipping splits processing');
    return;
  }

  const ai = getAIConfig();
  const geminiKey = ai.geminiApiKey;
  if (!geminiKey) {
    console.log('No geminiApiKey in config.ai, skipping splits processing');
    return;
  }

  console.log('Processing split images from Drive splits inbox...');
  if (!fs.existsSync(SPLITS_DIR)) fs.mkdirSync(SPLITS_DIR, { recursive: true });

  let files: { id: string; name: string; mimeType: string }[];
  try {
    files = await listSplitsInbox();
  } catch (err: any) {
    console.warn(`  ⚠ Could not list splits inbox: ${err.message}`);
    return;
  }

  const images = files.filter(f => f.mimeType.startsWith('image/'));
  if (images.length === 0) {
    console.log('  No new split images found');
    return;
  }
  console.log(`  Found ${images.length} image(s) to process`);

  const geminiModel = ai.models?.gemini || DEFAULT_GEMINI_MODEL;

  for (const file of images) {
    const baseName = file.name.replace(/\.[^.]+$/, '');
    const jsonPath = path.join(SPLITS_DIR, `${baseName}.json`);

    if (fs.existsSync(jsonPath)) {
      console.log(`  Skipping ${file.name} (already processed)`);
      continue;
    }

    console.log(`  Analyzing ${file.name}...`);

    const imageBuffer = await fetchFileBuffer(file.id);
    const imageBase64 = imageBuffer.toString('base64');

    const googleAI = createGoogleGenerativeAI({ apiKey: geminiKey });
    const { text } = await generateText({
      model: googleAI(geminiModel),
      messages: [{
        role: 'user',
        content: [
          { type: 'image', image: imageBase64, mediaType: file.mimeType },
          {
            type: 'text',
            text: `Analyze this Israeli payment app screenshot (Bit, PayBox, or similar).
Extract the following as JSON (no markdown, just raw JSON):
{
  "date": "YYYY-MM-DD",
  "app": "Bit or PayBox or other",
  "from": "sender name",
  "to": "recipient name",
  "amount": number (in NIS),
  "description": "what was written in the transfer note/memo, if any",
  "originalExpense": {
    "merchant": "restaurant/store name if mentioned",
    "total": total bill amount if mentioned,
    "date": "YYYY-MM-DD if mentioned"
  }
}
Notes:
- "from" is who sent the money, "to" is who received it
- If originalExpense details aren't visible, set it to null
- Amount should be a positive number
- Date format must be YYYY-MM-DD
- Return ONLY valid JSON, no explanation`,
          },
        ],
      }],
      maxOutputTokens: 1024,
    });

    try {
      const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      parsed.id = file.id;
      parsed.sourceImage = file.name;

      fs.writeFileSync(jsonPath, JSON.stringify(parsed, null, 2));
      console.log(`  ✓ Saved: splits/${baseName}.json (${parsed.from} → ${parsed.to}: ₪${parsed.amount})`);

      try {
        await deleteFile(file.id);
        console.log(`  ✓ Removed ${file.name} from Drive inbox`);
      } catch {
        console.log(`  ℹ Could not remove ${file.name} from Drive inbox`);
      }
    } catch (err: any) {
      console.warn(`  ⚠ Failed to analyze ${file.name}: ${err.message}`);
      fs.writeFileSync(jsonPath.replace('.json', '.error.txt'), text);
    }
  }
}

export function loadSplits(): SplitRecord[] {
  if (!fs.existsSync(SPLITS_DIR)) return [];
  const files = fs.readdirSync(SPLITS_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    try {
      return JSON.parse(fs.readFileSync(path.join(SPLITS_DIR, f), 'utf-8'));
    } catch {
      return null;
    }
  }).filter(Boolean);
}

export function getSplitAdjustments(month: string): { merchant: string; date: string; adjustment: number }[] {
  const splits = loadSplits();
  return splits
    .filter(s => s.date?.startsWith(month))
    .map(s => ({
      merchant: s.originalExpense?.merchant || s.description || '',
      date: s.date,
      adjustment: s.amount,
    }));
}
