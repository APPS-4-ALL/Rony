/**
 * Debug harness: run the REAL text extraction (unpdf) + field extractor on real
 * invoice files, printing the raw extracted text and the parsed fields so we can
 * see why extraction fails. Usage: tsx scripts/debug-extract.ts <file> [file...]
 */
import { readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { extractDocumentText } from '../src/main/download/extractText'
import { configureOcr, ocrDocument, terminateOcr } from '../src/main/download/ocr'
import { extractInvoiceFields } from '../src/shared/engines/extract'

configureOcr({ cacheDir: join(tmpdir(), 'rony-ocr-lang') })

/** Args = explicit files; otherwise scan the default invoices folder for PDFs. */
function resolveFiles(): string[] {
  const args = process.argv.slice(2)
  if (args.length > 0) return args
  const dir = join(homedir(), 'Documents', 'Rony Invoices')
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .map((f) => join(dir, f))
}

async function main(): Promise<void> {
  const files = resolveFiles()
  for (const file of files) {
    const bytes = readFileSync(file)
    const doc = { filename: basename(file), mimeType: 'application/pdf', bytes }
    let text = await extractDocumentText(doc)
    let via = 'text-layer'
    // Mirror the core: when there's no native text, fall back to OCR.
    if (!text || !text.trim()) {
      text = await ocrDocument(doc)
      via = 'OCR'
    }
    console.log('\n' + '='.repeat(80))
    console.log('FILE:', basename(file), `(${text && text.trim() ? via : 'no text'})`)
    console.log('-'.repeat(80))
    if (text == null || !text.trim()) {
      console.log('(no extractable text — even via OCR)')
      continue
    }
    const lines = text.split(/\r?\n/)
    lines.forEach((l, i) => console.log(String(i).padStart(3), JSON.stringify(l)))
    console.log('-'.repeat(80))
    console.log('EXTRACTED:', JSON.stringify(extractInvoiceFields(text)))
  }
  await terminateOcr()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
