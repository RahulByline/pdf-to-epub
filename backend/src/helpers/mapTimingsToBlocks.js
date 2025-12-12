/**
 * Map word-level timings to block-level syncs.
 * @param {Array} orderedBlocks - blocks sorted by readingOrder
 * @param {Array<{word:string,startTimeSec:number,endTimeSec?:number}>} timings - from TTS
 * @param {string} audioFileName - relative audio path (e.g., audio/page_1_tts.mp3)
 * @returns {Array<{ blockId:string, clipBegin:number, clipEnd:number, audioFileName:string }>}
 */
export function mapTimingsToBlocks(orderedBlocks, timings, audioFileName) {
  if (!Array.isArray(orderedBlocks) || !Array.isArray(timings) || !timings.length) {
    return [];
  }

  // Compute end times by looking ahead; last word gets small tail heuristic
  for (let i = 0; i < timings.length; i++) {
    const curr = timings[i];
    const next = timings[i + 1];
    if (next && next.startTimeSec !== undefined) {
      curr.endTimeSec = next.startTimeSec;
    } else {
      curr.endTimeSec = (curr.startTimeSec || 0) + 0.25;
    }
  }

  // Flatten words array for mapping
  const words = timings.map(t => t.word || '').map(w => (w || '').trim()).filter(Boolean);

  let timingIndex = 0;
  const syncs = [];

  for (let b = 0; b < orderedBlocks.length; b++) {
    const block = orderedBlocks[b];
    const blockWords = (block.text || '').match(/\S+/g) || [];
    if (blockWords.length === 0) continue;

    const startIdx = timingIndex;
    const endIdx = timingIndex + blockWords.length - 1;

    if (startIdx >= timings.length) break; // no more timings

    const first = timings[startIdx];
    const last = timings[Math.min(endIdx, timings.length - 1)];

    syncs.push({
      blockId: block.id || block.blockId || `block_${b}`,
      clipBegin: Number((first.startTimeSec || 0).toFixed(3)),
      clipEnd: Number((last.endTimeSec || last.startTimeSec || 0).toFixed(3)),
      audioFileName
    });

    timingIndex = endIdx + 1;
    if (timingIndex >= timings.length) break;
  }

  return syncs;
}

