package com.example.demo.service;

import com.example.demo.dto.conversion.DocumentStructure;
import com.example.demo.dto.conversion.PageStructure;
import com.example.demo.dto.conversion.TextBlock;
import com.example.demo.model.AudioSync;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import javax.sound.sampled.*;
import java.io.File;
import java.util.ArrayList;
import java.util.List;

/**
 * Audio Analysis Service - KITABOO-style automated audio synchronization
 * 
 * This service analyzes audio files and automatically matches text blocks to audio segments,
 * similar to how KITABOO uses TTS metadata for precise synchronization.
 */
@Service
public class AudioAnalysisService {

    private static final Logger logger = LoggerFactory.getLogger(AudioAnalysisService.class);
    
    // Average reading speeds (words per minute)
    private static final double SLOW_READING_WPM = 150.0;
    private static final double NORMAL_READING_WPM = 200.0;
    private static final double FAST_READING_WPM = 250.0;
    
    // Default reading speed
    private static final double DEFAULT_WPM = NORMAL_READING_WPM;
    
    // Silence detection thresholds
    private static final double SILENCE_THRESHOLD = 0.01; // Amplitude threshold for silence
    private static final double MIN_SILENCE_DURATION = 0.3; // Minimum silence duration in seconds
    
    /**
     * Analyzes audio file and generates automatic block-level syncs (KITABOO-style)
     * 
     * @param audioFile The audio file to analyze
     * @param structure The document structure with text blocks
     * @param pdfDocumentId PDF document ID
     * @param conversionJobId Conversion job ID
     * @param audioFilePath Path to the audio file
     * @return List of automatically generated AudioSync entries
     */
    public List<AudioSync> generateAutomaticSyncs(
            File audioFile,
            DocumentStructure structure,
            Long pdfDocumentId,
            Long conversionJobId,
            String audioFilePath) {
        
        logger.info("Starting KITABOO-style automatic audio sync generation");
        
        try {
            // Step 1: Get audio duration
            double totalAudioDuration = getAudioDuration(audioFile);
            logger.info("Audio duration: {} seconds", totalAudioDuration);
            
            if (totalAudioDuration <= 0) {
                logger.warn("Invalid audio duration, using fallback estimation");
                return generateFallbackSyncs(structure, pdfDocumentId, conversionJobId, audioFilePath, totalAudioDuration);
            }
            
            // Step 2: Detect silence/pauses in audio (for natural breaks)
            List<Double> silencePoints = detectSilencePoints(audioFile);
            logger.info("Detected {} silence points in audio", silencePoints.size());
            
            // Step 3: Calculate total words in document
            int totalWords = calculateTotalWords(structure);
            logger.info("Total words in document: {}", totalWords);
            
            if (totalWords == 0) {
                logger.warn("No text found in document, using page-level sync");
                return generatePageLevelSyncs(structure, pdfDocumentId, conversionJobId, audioFilePath, totalAudioDuration);
            }
            
            // Step 4: Generate block-level syncs (KITABOO approach)
            List<AudioSync> syncs = new ArrayList<>();
            double currentTime = 0.0;
            int silenceIndex = 0;
            
            // Calculate average words per second based on total duration
            double wordsPerSecond = totalWords / totalAudioDuration;
            logger.info("Calculated reading speed: {:.2f} words/second ({:.0f} WPM)", 
                      wordsPerSecond, wordsPerSecond * 60);
            
            for (PageStructure page : structure.getPages()) {
                if (page.getTextBlocks() == null || page.getTextBlocks().isEmpty()) {
                    // Empty page - assign minimal time
                    if (currentTime < totalAudioDuration) {
                        AudioSync sync = createPageLevelSync(
                            page.getPageNumber(), 
                            currentTime, 
                            Math.min(currentTime + 1.0, totalAudioDuration),
                            pdfDocumentId, conversionJobId, audioFilePath);
                        syncs.add(sync);
                        currentTime += 1.0;
                    }
                    continue;
                }
                
                // Calculate total words on this page
                int pageWordCount = 0;
                for (TextBlock block : page.getTextBlocks()) {
                    if (block.getText() != null && !block.getText().trim().isEmpty()) {
                        pageWordCount += countWords(block.getText());
                    }
                }
                
                if (pageWordCount == 0) {
                    continue;
                }
                
                // Calculate page duration based on word count
                double pageDuration = (pageWordCount / (double) totalWords) * totalAudioDuration;
                
                // Adjust for silence points (natural pauses)
                double pageStartTime = currentTime;
                double adjustedPageDuration = adjustForSilence(
                    pageStartTime, pageDuration, silencePoints, silenceIndex);
                
                // Distribute page time across blocks
                double blockStartTime = pageStartTime;
                
                for (TextBlock block : page.getTextBlocks()) {
                    if (block.getText() == null || block.getText().trim().isEmpty()) {
                        continue;
                    }
                    
                    int blockWordCount = countWords(block.getText());
                    if (blockWordCount == 0) {
                        continue;
                    }
                    
                    // Calculate block duration proportionally
                    double blockDuration = (blockWordCount / (double) pageWordCount) * adjustedPageDuration;
                    
                    // Ensure minimum duration
                    if (blockDuration < 0.3) {
                        blockDuration = 0.3;
                    }
                    
                    // Check for silence points within this block's time range
                    double blockEndTime = blockStartTime + blockDuration;
                    blockEndTime = adjustBlockEndForSilence(blockStartTime, blockEndTime, silencePoints);
                    
                    // Ensure we don't exceed audio duration
                    if (blockEndTime > totalAudioDuration) {
                        blockEndTime = totalAudioDuration;
                    }
                    
                    if (blockStartTime < totalAudioDuration && blockEndTime > blockStartTime) {
                        AudioSync sync = new AudioSync();
                        sync.setPdfDocumentId(pdfDocumentId);
                        sync.setConversionJobId(conversionJobId);
                        sync.setPageNumber(page.getPageNumber());
                        sync.setBlockId(block.getId()); // Block-level sync (KITABOO-style)
                        sync.setStartTime(blockStartTime);
                        sync.setEndTime(blockEndTime);
                        sync.setAudioFilePath(audioFilePath);
                        
                        syncs.add(sync);
                        logger.debug("Generated sync for page {} block {}: {:.2f}s - {:.2f}s ({} words)", 
                                   page.getPageNumber(), block.getId(), blockStartTime, blockEndTime, blockWordCount);
                    }
                    
                    blockStartTime = blockEndTime;
                    
                    // Stop if we've used all audio time
                    if (blockStartTime >= totalAudioDuration) {
                        break;
                    }
                }
                
                currentTime = blockStartTime;
                
                // Update silence index
                while (silenceIndex < silencePoints.size() && 
                       silencePoints.get(silenceIndex) < currentTime) {
                    silenceIndex++;
                }
                
                // Stop if we've used all audio time
                if (currentTime >= totalAudioDuration) {
                    break;
                }
            }
            
            logger.info("Generated {} automatic block-level syncs (KITABOO-style)", syncs.size());
            return syncs;
            
        } catch (Exception e) {
            logger.error("Error generating automatic syncs: {}", e.getMessage(), e);
            // Fallback to simple proportional sync
            return generateFallbackSyncs(structure, pdfDocumentId, conversionJobId, audioFilePath, 
                                       getAudioDuration(audioFile));
        }
    }
    
    /**
     * Gets audio file duration in seconds
     */
    private double getAudioDuration(File audioFile) {
        try {
            AudioFileFormat audioFileFormat = AudioSystem.getAudioFileFormat(audioFile);
            
            if (audioFileFormat.properties() != null) {
                Object durationProperty = audioFileFormat.properties().get("duration");
                if (durationProperty instanceof Long) {
                    // Duration is in microseconds, convert to seconds
                    return ((Long) durationProperty) / 1_000_000.0;
                }
            }
            
            // Fallback: estimate based on file size and format
            long fileSizeBytes = audioFile.length();
            String format = audioFileFormat.getType().toString();
            
            // Rough estimates for common formats
            if (format.contains("MPEG") || format.contains("MP3")) {
                // MP3: ~1 MB per minute at 128 kbps
                return (fileSizeBytes / 1_000_000.0) * 60.0;
            } else if (format.contains("WAVE") || format.contains("WAV")) {
                // WAV: depends on sample rate and bit depth
                AudioFormat format2 = audioFileFormat.getFormat();
                long frameLength = audioFileFormat.getFrameLength();
                if (frameLength > 0 && format2.getFrameRate() > 0) {
                    return frameLength / format2.getFrameRate();
                }
            }
            
            // Last resort: generic estimate
            double estimatedDuration = (fileSizeBytes / 1_000_000.0) * 60.0;
            logger.info("Estimated audio duration: {} seconds from file size", estimatedDuration);
            return estimatedDuration;
            
        } catch (Exception e) {
            logger.warn("Error getting audio duration: {}", e.getMessage());
            // Last resort: estimate based on file size
            long fileSizeBytes = audioFile.length();
            return (fileSizeBytes / 1_000_000.0) * 60.0;
        }
    }
    
    /**
     * Detects silence points in audio (for natural pause detection)
     */
    private List<Double> detectSilencePoints(File audioFile) {
        List<Double> silencePoints = new ArrayList<>();
        
        try {
            AudioInputStream audioInputStream = AudioSystem.getAudioInputStream(audioFile);
            AudioFormat format = audioInputStream.getFormat();
            
            // Convert to PCM if needed
            if (format.getEncoding() != AudioFormat.Encoding.PCM_SIGNED) {
                AudioFormat targetFormat = new AudioFormat(
                    AudioFormat.Encoding.PCM_SIGNED,
                    format.getSampleRate(),
                    16,
                    format.getChannels(),
                    format.getChannels() * 2,
                    format.getSampleRate(),
                    false
                );
                audioInputStream = AudioSystem.getAudioInputStream(targetFormat, audioInputStream);
                format = targetFormat;
            }
            
            int frameSize = format.getFrameSize();
            int sampleRate = (int) format.getSampleRate();
            byte[] buffer = new byte[frameSize * sampleRate / 10]; // 100ms chunks
            
            double currentTime = 0.0;
            double silenceStartTime = -1.0;
            
            int bytesRead;
            while ((bytesRead = audioInputStream.read(buffer)) > 0) {
                double chunkDuration = (bytesRead / (double) frameSize) / sampleRate;
                
                // Calculate RMS (Root Mean Square) for amplitude
                double rms = calculateRMS(buffer, bytesRead, format);
                
                if (rms < SILENCE_THRESHOLD) {
                    // Silence detected
                    if (silenceStartTime < 0) {
                        silenceStartTime = currentTime;
                    }
                } else {
                    // Sound detected
                    if (silenceStartTime >= 0) {
                        double silenceDuration = currentTime - silenceStartTime;
                        if (silenceDuration >= MIN_SILENCE_DURATION) {
                            // Significant silence - mark as pause point
                            silencePoints.add(silenceStartTime + silenceDuration / 2);
                        }
                        silenceStartTime = -1.0;
                    }
                }
                
                currentTime += chunkDuration;
            }
            
            audioInputStream.close();
            
        } catch (Exception e) {
            logger.warn("Error detecting silence points: {}", e.getMessage());
            // Continue without silence detection
        }
        
        return silencePoints;
    }
    
    /**
     * Calculates RMS (Root Mean Square) amplitude
     */
    private double calculateRMS(byte[] buffer, int length, AudioFormat format) {
        if (format.getSampleSizeInBits() == 16) {
            double sum = 0.0;
            int samples = length / 2;
            for (int i = 0; i < samples; i++) {
                int sample = (buffer[i * 2] & 0xFF) | ((buffer[i * 2 + 1] & 0xFF) << 8);
                if (format.isBigEndian()) {
                    sample = (buffer[i * 2] << 8) | (buffer[i * 2 + 1] & 0xFF);
                }
                if (format.getEncoding() == AudioFormat.Encoding.PCM_SIGNED) {
                    if (sample > 32767) sample -= 65536;
                }
                sum += sample * sample;
            }
            return Math.sqrt(sum / samples) / 32768.0;
        }
        return 0.0;
    }
    
    /**
     * Adjusts timing for detected silence points
     */
    private double adjustForSilence(double startTime, double duration, 
                                    List<Double> silencePoints, int startIndex) {
        double endTime = startTime + duration;
        double adjustedDuration = duration;
        
        // Check for silence points in this time range
        for (int i = startIndex; i < silencePoints.size(); i++) {
            double silencePoint = silencePoints.get(i);
            if (silencePoint >= startTime && silencePoint <= endTime) {
                // Adjust duration to account for silence
                adjustedDuration += 0.2; // Add small buffer for pauses
            }
            if (silencePoint > endTime) {
                break;
            }
        }
        
        return adjustedDuration;
    }
    
    /**
     * Adjusts block end time to align with silence points if close
     */
    private double adjustBlockEndForSilence(double startTime, double endTime, 
                                           List<Double> silencePoints) {
        // Find nearest silence point near the end time
        for (double silencePoint : silencePoints) {
            if (silencePoint > startTime && silencePoint < endTime) {
                double distanceToEnd = Math.abs(silencePoint - endTime);
                if (distanceToEnd < 0.5) {
                    // Align with silence point
                    return silencePoint;
                }
            }
        }
        return endTime;
    }
    
    /**
     * Counts words in text
     */
    private int countWords(String text) {
        if (text == null || text.trim().isEmpty()) {
            return 0;
        }
        return text.trim().split("\\s+").length;
    }
    
    /**
     * Calculates total words in document
     */
    private int calculateTotalWords(DocumentStructure structure) {
        int total = 0;
        if (structure.getPages() != null) {
            for (PageStructure page : structure.getPages()) {
                if (page.getTextBlocks() != null) {
                    for (TextBlock block : page.getTextBlocks()) {
                        if (block.getText() != null) {
                            total += countWords(block.getText());
                        }
                    }
                }
            }
        }
        return total;
    }
    
    /**
     * Generates fallback syncs (simple proportional distribution)
     */
    private List<AudioSync> generateFallbackSyncs(DocumentStructure structure,
                                                  Long pdfDocumentId,
                                                  Long conversionJobId,
                                                  String audioFilePath,
                                                  double totalDuration) {
        logger.info("Using fallback sync generation");
        
        List<AudioSync> syncs = new ArrayList<>();
        int totalWords = calculateTotalWords(structure);
        
        if (totalWords == 0 || totalDuration <= 0) {
            return syncs;
        }
        
        double currentTime = 0.0;
        
        for (PageStructure page : structure.getPages()) {
            if (page.getTextBlocks() != null && !page.getTextBlocks().isEmpty()) {
                int pageWords = 0;
                for (TextBlock block : page.getTextBlocks()) {
                    if (block.getText() != null) {
                        pageWords += countWords(block.getText());
                    }
                }
                
                double pageDuration = (pageWords / (double) totalWords) * totalDuration;
                
                if (currentTime + pageDuration <= totalDuration && pageDuration > 0) {
                    AudioSync sync = createPageLevelSync(
                        page.getPageNumber(),
                        currentTime,
                        currentTime + pageDuration,
                        pdfDocumentId, conversionJobId, audioFilePath);
                    syncs.add(sync);
                    currentTime += pageDuration;
                }
            }
        }
        
        return syncs;
    }
    
    /**
     * Generates page-level syncs (when block-level is not possible)
     */
    private List<AudioSync> generatePageLevelSyncs(DocumentStructure structure,
                                                  Long pdfDocumentId,
                                                  Long conversionJobId,
                                                  String audioFilePath,
                                                  double totalDuration) {
        List<AudioSync> syncs = new ArrayList<>();
        int pageCount = structure.getPages() != null ? structure.getPages().size() : 0;
        
        if (pageCount == 0 || totalDuration <= 0) {
            return syncs;
        }
        
        double durationPerPage = totalDuration / pageCount;
        double currentTime = 0.0;
        
        for (PageStructure page : structure.getPages()) {
            if (currentTime < totalDuration) {
                AudioSync sync = createPageLevelSync(
                    page.getPageNumber(),
                    currentTime,
                    Math.min(currentTime + durationPerPage, totalDuration),
                    pdfDocumentId, conversionJobId, audioFilePath);
                syncs.add(sync);
                currentTime += durationPerPage;
            }
        }
        
        return syncs;
    }
    
    /**
     * Creates a page-level AudioSync (no blockId)
     */
    private AudioSync createPageLevelSync(int pageNumber, double startTime, double endTime,
                                         Long pdfDocumentId, Long conversionJobId, String audioFilePath) {
        AudioSync sync = new AudioSync();
        sync.setPdfDocumentId(pdfDocumentId);
        sync.setConversionJobId(conversionJobId);
        sync.setPageNumber(pageNumber);
        // No blockId = page-level sync
        sync.setStartTime(startTime);
        sync.setEndTime(endTime);
        sync.setAudioFilePath(audioFilePath);
        return sync;
    }
}

