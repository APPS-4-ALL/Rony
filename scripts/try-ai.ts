/**
 * Manual LIVE check for the RONY-10 AI engine.
 *
 * Makes a real API call so you can see the actual structured JSON the model
 * returns for a sample (Hebrew) invoice email. Requires a real key in `.env`:
 *
 *   AI_PROVIDER=openai          # or "gemini"
 *   OPENAI_API_KEY=...          # or GEMINI_API_KEY=...
 *
 * Run:  npm run ai:try
 */
import { classifyWithAI } from '../src/main/engines/ai'

const sample = {
  subject: 'חשבונית מס 1234 מאת Vendor Co.',
  body: 'תודה על רכישתך. סכום לתשלום: ₪351.00. תאריך: 01/05/2026.',
  from: 'billing@vendor.co.il',
  filenames: ['invoice_1234.pdf']
}

async function main(): Promise<void> {
  try {
    const result = await classifyWithAI(sample)
    console.log('AI result:\n' + JSON.stringify(result, null, 2))
  } catch (err) {
    console.error('AI call failed:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  }
}

void main()
