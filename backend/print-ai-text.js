import { GeminiService } from './src/services/geminiService.js';

async function main() {
  const pdfPath = 'uploads/c4b549e6-3c25-4f90-a82b-ef1d20debf90.pdf';
  const data = await GeminiService.extractTextFromPdf(pdfPath);
  if (!data) {
    console.log('No AI text extracted');
    return;
  }
  for (const page of data.pages) {
    const text = page.text || '';
    console.log(`\n--- Page ${page.pageNumber} (len=${text.length}) ---`);
    if (!text.trim()) {
      console.log('[empty]');
      continue;
    }
    const snippet = text.slice(0, 1200);
    console.log(snippet);
    if (text.length > 1200) {
      console.log(`... [truncated ${text.length - 1200} chars]`);
    }
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
