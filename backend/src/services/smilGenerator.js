/**
 * SMIL Generator from Transcript
 * 
 * Generates EPUB3-compliant SMIL (Synchronized Multimedia Integration Language)
 * files from transcript JSON data.
 * 
 * Architecture:
 * - Transcript JSON is the single source of truth
 * - Each fragment in transcript becomes a <par> element in SMIL
 * - Fragment IDs must match XHTML element IDs exactly
 * - Audio clipBegin/clipEnd use timings from transcript (aeneas output)
 * 
 * SMIL Structure:
 * <smil>
 *   <body>
 *     <seq> (sequence of parallel elements)
 *       <par> (parallel: text + audio)
 *         <text src="chapter.xhtml#fragmentId"/>
 *         <audio src="audio.mp3" clipBegin="0.000s" clipEnd="2.345s"/>
 *       </par>
 *     </seq>
 *   </body>
 * </smil>
 */

/**
 * Generate SMIL content from transcript JSON
 * 
 * @param {Object} transcript - Transcript JSON data
 * @param {string} xhtmlFileName - Name of XHTML file (e.g., "page_1.xhtml")
 * @param {string} audioFileName - Name of audio file (e.g., "audio.mp3")
 * @param {Object} options - Additional options
 * @returns {string} SMIL XML content
 */
export function generateSMILFromTranscript(transcript, xhtmlFileName, audioFileName, options = {}) {
  const {
    namespace = 'http://www.w3.org/2001/SMIL20/',
    epubNamespace = 'http://www.idpf.org/2007/ops'
  } = options;

  if (!transcript || !transcript.fragments || transcript.fragments.length === 0) {
    throw new Error('Transcript must have fragments array');
  }

  // Build sequence of parallel elements
  const parElements = transcript.fragments
    .filter(fragment => {
      // Only include fragments with valid timings
      return fragment.startTime !== undefined && 
             fragment.endTime !== undefined &&
             fragment.startTime >= 0 &&
             fragment.endTime > fragment.startTime;
    })
    .map(fragment => {
      // Format timings as SMIL time values (seconds with 's' suffix)
      const clipBegin = `${fragment.startTime.toFixed(3)}s`;
      const clipEnd = `${fragment.endTime.toFixed(3)}s`;

      return `      <par>
        <text src="${xhtmlFileName}#${fragment.id}"/>
        <audio src="${audioFileName}" clipBegin="${clipBegin}" clipEnd="${clipEnd}"/>
      </par>`;
    })
    .join('\n');

  // Build complete SMIL document
  const smilContent = `<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="${namespace}" xmlns:epub="${epubNamespace}" version="3.0">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${transcript.jobId}-page-${transcript.pageNumber}"/>
    <meta name="dtb:totalElapsedTime" content="${getTotalDuration(transcript).toFixed(3)}"/>
    <meta name="dtb:audioClock" content="UTC"/>
  </head>
  <body>
    <seq>
${parElements}
    </seq>
  </body>
</smil>`;

  return smilContent;
}

/**
 * Calculate total duration from transcript fragments
 */
function getTotalDuration(transcript) {
  if (!transcript.fragments || transcript.fragments.length === 0) {
    return 0;
  }

  const lastFragment = transcript.fragments[transcript.fragments.length - 1];
  return lastFragment.endTime || 0;
}

/**
 * Generate SMIL file and save to disk
 * 
 * @param {Object} transcript - Transcript JSON data
 * @param {string} outputDir - Directory to save SMIL file
 * @param {string} xhtmlFileName - Name of XHTML file
 * @param {string} audioFileName - Name of audio file
 * @returns {Promise<string>} Path to saved SMIL file
 */
export async function generateAndSaveSMIL(transcript, outputDir, xhtmlFileName, audioFileName) {
  const fs = await import('fs/promises');
  const path = await import('path');

  const smilContent = generateSMILFromTranscript(transcript, xhtmlFileName, audioFileName);
  const smilFileName = `page_${transcript.pageNumber}.smil`;
  const smilPath = path.join(outputDir, smilFileName);

  await fs.writeFile(smilPath, smilContent, 'utf8');

  console.log(`[SMILGenerator] Generated SMIL file: ${smilFileName} with ${transcript.fragments.length} fragments`);

  return smilPath;
}






