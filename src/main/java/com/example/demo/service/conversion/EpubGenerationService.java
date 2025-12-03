package com.example.demo.service.conversion;

import com.example.demo.dto.conversion.*;
import net.lingala.zip4j.ZipFile;
import net.lingala.zip4j.model.ZipParameters;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.apache.pdfbox.rendering.ImageType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import com.example.demo.model.AudioSync;

@Service
public class EpubGenerationService {

    private static final Logger logger = LoggerFactory.getLogger(EpubGenerationService.class);
    
    @Value("${html.intermediate.dir:html_intermediate}")
    private String htmlIntermediateDir;
    
    @Value("${html.intermediate.enabled:true}")
    private boolean htmlIntermediateEnabled;

    public String generateEpub(DocumentStructure structure, String outputDir, String fileName) throws IOException {
        return generateEpub(structure, outputDir, fileName, null, null, null);
    }

    public String generateEpub(DocumentStructure structure, String outputDir, String fileName, File pdfFile) throws IOException {
        return generateEpub(structure, outputDir, fileName, pdfFile, null, null);
    }

    public String generateEpub(DocumentStructure structure, String outputDir, String fileName, File pdfFile, 
                                File audioFile, List<AudioSync> audioSyncs) throws IOException {
        Path outputPath = Paths.get(outputDir);
        Files.createDirectories(outputPath);
        
        // Create temporary directory for EPUB contents
        Path tempDir = outputPath.resolve("temp_" + UUID.randomUUID().toString());
        Files.createDirectories(tempDir);
        
        try {
            // Create META-INF directory
            Path metaInfDir = tempDir.resolve("META-INF");
            Files.createDirectories(metaInfDir);
            
            // Create OEBPS directory for content
            Path oebpsDir = tempDir.resolve("OEBPS");
            Files.createDirectories(oebpsDir);
            
            // Create organized subdirectories in OEBPS
            Path audioDir = oebpsDir.resolve("audio");
            Path cssDir = oebpsDir.resolve("css");
            Path fontDir = oebpsDir.resolve("font");
            Path imageDir = oebpsDir.resolve("image");
            Path jsDir = oebpsDir.resolve("js");
            Files.createDirectories(audioDir);
            Files.createDirectories(cssDir);
            Files.createDirectories(fontDir);
            Files.createDirectories(imageDir);
            Files.createDirectories(jsDir);
            
            // Generate mimetype file (must be first, uncompressed)
            createMimetypeFile(tempDir);
            
            // Generate container.xml
            createContainerFile(metaInfDir);
            
            // Render PDF pages as images for fixed-layout EPUB (save to image/ folder)
            List<String> pageImageNames = new ArrayList<>();
            if (pdfFile != null && pdfFile.exists()) {
                pageImageNames = renderPdfPagesAsImages(pdfFile, imageDir, structure);
            }
            
            // Generate content.opf with fixed-layout metadata
            createContentOpf(oebpsDir, structure, fileName, pageImageNames);
            
            // Generate nav.xhtml (table of contents)
            createNavFile(oebpsDir, structure);
            
            // Step 1: Generate intermediate HTML files (if enabled)
            Path htmlIntermediatePath = null;
            if (htmlIntermediateEnabled) {
                htmlIntermediatePath = generateIntermediateHtmlFiles(structure, pageImageNames, fileName);
                logger.info("Generated intermediate HTML files in: {}", htmlIntermediatePath);
            }
            
            // Step 2: Generate XHTML files from HTML (or directly from structure)
            List<String> contentFileNames;
            if (htmlIntermediateEnabled && htmlIntermediatePath != null) {
                // Convert HTML to XHTML
                contentFileNames = convertHtmlToXhtml(htmlIntermediatePath, oebpsDir, structure, pageImageNames);
                logger.info("Converted HTML files to XHTML for EPUB");
            } else {
                // Direct XHTML generation (backward compatible)
                contentFileNames = generateFixedLayoutContentFiles(oebpsDir, structure, pageImageNames);
            }
            
            // Create CSS for fixed layout (save to css/ folder)
            createFixedLayoutCSS(cssDir);
            
            // Copy images if any (save to image/ folder)
            copyImages(imageDir, structure);
            
            // Handle audio and SMIL files if audio syncs are provided
            String audioFileName = null;
            List<String> smilFileNames = new ArrayList<>();
            if (audioFile != null && audioSyncs != null && !audioSyncs.isEmpty()) {
                audioFileName = copyAudioFile(audioFile, audioDir);
                smilFileNames = generateSmilFiles(oebpsDir, audioSyncs, audioFileName, structure);
                
                // Update content.opf to include audio and SMIL files
                updateContentOpfForAudio(oebpsDir, audioFileName, smilFileNames, structure, pageImageNames, audioSyncs);
                
                // Update content files to reference SMIL
                updateContentFilesForAudio(oebpsDir, smilFileNames, structure);
            }
            
            // Create EPUB ZIP file
            String epubPath = outputPath.resolve(fileName + ".epub").toString();
            createEpubZip(tempDir, epubPath);
            
            logger.info("EPUB generated successfully: " + epubPath);
            return epubPath;
            
        } finally {
            // Clean up temporary directory
            deleteDirectory(tempDir);
        }
    }

    private void createMimetypeFile(Path tempDir) throws IOException {
        Path mimetypeFile = tempDir.resolve("mimetype");
        Files.write(mimetypeFile, "application/epub+zip".getBytes(StandardCharsets.UTF_8));
    }

    private void createContainerFile(Path metaInfDir) throws IOException {
        String containerXml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
            "<container version=\"1.0\" xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\">\n" +
            "  <rootfiles>\n" +
            "    <rootfile full-path=\"OEBPS/content.opf\" media-type=\"application/oebps-package+xml\"/>\n" +
            "  </rootfiles>\n" +
            "</container>";
        
        Files.write(metaInfDir.resolve("container.xml"), containerXml.getBytes(StandardCharsets.UTF_8));
    }

    private List<String> renderPdfPagesAsImages(File pdfFile, Path oebpsDir, DocumentStructure structure) throws IOException {
        List<String> imageNames = new ArrayList<>();
        
        try (PDDocument document = Loader.loadPDF(pdfFile)) {
            // Create renderer with consistent settings for all pages
            PDFRenderer renderer = new PDFRenderer(document);
            // Ensure consistent rendering across all pages
            renderer.setSubsamplingAllowed(false); // Disable subsampling for better quality
            
            int totalPages = document.getNumberOfPages();
            
            // Get page dimensions from first page for viewport (assuming uniform page size)
            int pageWidth = 1200; // Default
            int pageHeight = 1600; // Default
            if (totalPages > 0) {
                PDPage firstPage = document.getPage(0);
                PDRectangle mediaBox = firstPage.getMediaBox();
                // Convert points to pixels at 300 DPI (1 point = 1/72 inch, 300 DPI = 300/72 points per pixel)
                pageWidth = (int) (mediaBox.getWidth() * 300 / 72);
                pageHeight = (int) (mediaBox.getHeight() * 300 / 72);
                logger.debug("Page dimensions: {}x{} pixels (from {}x{} points)", 
                    pageWidth, pageHeight, mediaBox.getWidth(), mediaBox.getHeight());
            }
            
            for (int i = 0; i < totalPages; i++) {
                // Render page at 300 DPI for high quality with consistent color settings
                // Use ARGB to preserve transparency and handle backgrounds correctly
                BufferedImage image = renderer.renderImageWithDPI(i, 300, ImageType.ARGB);
                
                // Create a white background image to composite on (prevents black backgrounds)
                BufferedImage rgbImage = new BufferedImage(
                    image.getWidth(), 
                    image.getHeight(), 
                    BufferedImage.TYPE_INT_RGB
                );
                
                // Fill with white background first
                java.awt.Graphics2D g = rgbImage.createGraphics();
                g.setColor(java.awt.Color.WHITE);
                g.fillRect(0, 0, image.getWidth(), image.getHeight());
                
                // Set rendering hints for quality
                g.setRenderingHint(java.awt.RenderingHints.KEY_INTERPOLATION, 
                                 java.awt.RenderingHints.VALUE_INTERPOLATION_BILINEAR);
                g.setRenderingHint(java.awt.RenderingHints.KEY_RENDERING, 
                                 java.awt.RenderingHints.VALUE_RENDER_QUALITY);
                g.setRenderingHint(java.awt.RenderingHints.KEY_ANTIALIASING, 
                                 java.awt.RenderingHints.VALUE_ANTIALIAS_ON);
                g.setRenderingHint(java.awt.RenderingHints.KEY_ALPHA_INTERPOLATION,
                                 java.awt.RenderingHints.VALUE_ALPHA_INTERPOLATION_QUALITY);
                
                // Composite the rendered image onto white background
                // This ensures transparent areas become white instead of black
                g.setComposite(java.awt.AlphaComposite.SrcOver);
                g.drawImage(image, 0, 0, null);
                g.dispose();
                image = rgbImage;
                
                // Save as PNG with consistent settings (in image/ folder)
                String imageName = "page_" + (i + 1) + ".png";
                Path imagePath = oebpsDir.resolve(imageName);
                
                // Use PNG writer with consistent settings
                javax.imageio.ImageWriter writer = ImageIO.getImageWritersByFormatName("png").next();
                javax.imageio.ImageWriteParam param = writer.getDefaultWriteParam();
                if (param.canWriteCompressed()) {
                    param.setCompressionMode(javax.imageio.ImageWriteParam.MODE_EXPLICIT);
                    param.setCompressionQuality(1.0f); // Maximum quality
                }
                
                try (javax.imageio.stream.ImageOutputStream output = 
                     ImageIO.createImageOutputStream(imagePath.toFile())) {
                    writer.setOutput(output);
                    writer.write(null, new javax.imageio.IIOImage(image, null, null), param);
                } finally {
                    writer.dispose();
                }
                
                // Return path relative to OEBPS (image/page_X.png)
                imageNames.add("image/" + imageName);
                
                logger.debug("Rendered page {} as image: {} ({}x{} pixels, type: {})", 
                    i + 1, imageName, image.getWidth(), image.getHeight(), image.getType());
            }
            
            // Store page dimensions in structure for viewport (if needed)
            // For now, we'll use the calculated dimensions in HTML generation
        }
        
        return imageNames;
    }

    private void createContentOpf(Path oebpsDir, DocumentStructure structure, String fileName) throws IOException {
        createContentOpf(oebpsDir, structure, fileName, new ArrayList<>());
    }

    private void createContentOpf(Path oebpsDir, DocumentStructure structure, String fileName, List<String> pageImageNames) throws IOException {
        DocumentMetadata metadata = structure.getMetadata();
        if (metadata == null) {
            metadata = new DocumentMetadata();
        }
        
        StringBuilder opf = new StringBuilder();
        opf.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        opf.append("<package xmlns=\"http://www.idpf.org/2007/opf\" ");
        opf.append("xmlns:rendition=\"http://www.idpf.org/2013/rendition\" ");
        opf.append("unique-identifier=\"book-id\" version=\"3.0\">\n");
        opf.append("  <metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\">\n");
        
        // Title
        String title = metadata.getTitle() != null ? escapeXml(metadata.getTitle()) : "Untitled";
        opf.append("    <dc:title>").append(title).append("</dc:title>\n");
        
        // Language
        String language = metadata.getLanguage() != null ? metadata.getLanguage() : "en";
        opf.append("    <dc:language>").append(language).append("</dc:language>\n");
        
        // Identifier
        String identifier = metadata.getIsbn() != null ? metadata.getIsbn() : "urn:uuid:" + UUID.randomUUID().toString();
        opf.append("    <dc:identifier id=\"book-id\">").append(identifier).append("</dc:identifier>\n");
        
        // Authors
        if (metadata.getAuthors() != null && !metadata.getAuthors().isEmpty()) {
            for (String author : metadata.getAuthors()) {
                opf.append("    <dc:creator>").append(escapeXml(author)).append("</dc:creator>\n");
            }
        }
        
        // Publisher
        if (metadata.getPublisher() != null) {
            opf.append("    <dc:publisher>").append(escapeXml(metadata.getPublisher())).append("</dc:publisher>\n");
        }
        
        // Subject
        if (metadata.getSubject() != null) {
            opf.append("    <dc:subject>").append(escapeXml(metadata.getSubject())).append("</dc:subject>\n");
        }
        
        opf.append("    <meta property=\"dcterms:modified\">").append(java.time.ZonedDateTime.now().toString()).append("</meta>\n");
        
        // Fixed-layout metadata (EPUB3 specification) - Full screen constant display
        if (!pageImageNames.isEmpty()) {
            opf.append("    <meta property=\"rendition:layout\">pre-paginated</meta>\n");
            opf.append("    <meta property=\"rendition:orientation\">auto</meta>\n");
            opf.append("    <meta property=\"rendition:spread\">none</meta>\n");
            opf.append("    <meta property=\"rendition:viewport\">width=device-width, height=device-height</meta>\n");
        }
        
        opf.append("  </metadata>\n");
        
        // Manifest
        opf.append("  <manifest>\n");
        opf.append("    <item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\"/>\n");
        
        // Add CSS for fixed layout (in css/ folder)
        if (!pageImageNames.isEmpty()) {
            opf.append("    <item id=\"css\" href=\"css/fixed-layout.css\" media-type=\"text/css\"/>\n");
        }
        
        // Add page images (in image/ folder)
        int imageId = 1;
        for (String imageName : pageImageNames) {
            opf.append("    <item id=\"page-img-").append(imageId).append("\" href=\"").append(escapeXml(imageName))
               .append("\" media-type=\"image/png\"/>\n");
            imageId++;
        }
        
        int itemId = 1;
        List<String> contentFileNames = !pageImageNames.isEmpty() ? 
            getFixedLayoutContentFileNames(structure) : getContentFileNames(structure);
        
        for (String contentFile : contentFileNames) {
            opf.append("    <item id=\"page").append(itemId).append("\" href=\"").append(contentFile)
               .append("\" media-type=\"application/xhtml+xml\"");
            if (!pageImageNames.isEmpty()) {
                opf.append(" properties=\"rendition:page-spread-center\""); // Fixed layout property
            }
            opf.append("/>\n");
            itemId++;
        }
        
        // Add other images (in image/ folder)
        if (structure.getImages() != null) {
            for (ImageReference image : structure.getImages()) {
                String imageName = new File(image.getEpubPath() != null ? image.getEpubPath() : image.getOriginalPath()).getName();
                opf.append("    <item id=\"img-").append(image.getId()).append("\" href=\"image/").append(escapeXml(imageName))
                   .append("\" media-type=\"image/png\"/>\n");
            }
        }
        
        opf.append("  </manifest>\n");
        
        // Spine
        opf.append("  <spine toc=\"nav\">\n");
        itemId = 1;
        for (String contentFile : contentFileNames) {
            opf.append("    <itemref idref=\"page").append(itemId).append("\"/>\n");
            itemId++;
        }
        opf.append("  </spine>\n");
        
        opf.append("</package>");
        
        Files.write(oebpsDir.resolve("content.opf"), opf.toString().getBytes(StandardCharsets.UTF_8));
    }

    private void createNavFile(Path oebpsDir, DocumentStructure structure) throws IOException {
        StringBuilder nav = new StringBuilder();
        nav.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        nav.append("<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\">\n");
        nav.append("<head><title>Table of Contents</title></head>\n");
        nav.append("<body>\n");
        nav.append("  <nav epub:type=\"toc\" id=\"toc\">\n");
        nav.append("    <h1>Table of Contents</h1>\n");
        nav.append("    <ol>\n");
        
        if (structure.getTableOfContents() != null && structure.getTableOfContents().getEntries() != null) {
            for (TocEntry entry : structure.getTableOfContents().getEntries()) {
                addTocEntry(nav, entry, 0);
            }
        }
        
        nav.append("    </ol>\n");
        nav.append("  </nav>\n");
        nav.append("</body>\n");
        nav.append("</html>");
        
        Files.write(oebpsDir.resolve("nav.xhtml"), nav.toString().getBytes(StandardCharsets.UTF_8));
    }

    private void addTocEntry(StringBuilder nav, TocEntry entry, int depth) {
        String indent = "      " + "  ".repeat(depth);
        nav.append(indent).append("<li><a href=\"").append(entry.getTargetId() != null ? entry.getTargetId() : "#")
           .append("\">").append(escapeXml(entry.getTitle())).append("</a>");
        
        if (entry.getChildren() != null && !entry.getChildren().isEmpty()) {
            nav.append("\n").append(indent).append("  <ol>\n");
            for (TocEntry child : entry.getChildren()) {
                addTocEntry(nav, child, depth + 1);
            }
            nav.append(indent).append("  </ol>\n").append(indent);
        }
        
        nav.append("</li>\n");
    }

    private List<String> generateContentFiles(Path oebpsDir, DocumentStructure structure) throws IOException {
        List<String> fileNames = new ArrayList<>();
        List<List<PageStructure>> chapters = groupPagesIntoChapters(structure);
        
        int chapterIndex = 1;
        for (List<PageStructure> chapter : chapters) {
            String fileName = "chapter_" + chapterIndex + ".xhtml";
            String htmlContent = generateChapterHTML(chapter, structure);
            Files.write(oebpsDir.resolve(fileName), htmlContent.getBytes(StandardCharsets.UTF_8));
            fileNames.add(fileName);
            chapterIndex++;
        }
        
        return fileNames;
    }

    private List<String> generateFixedLayoutContentFiles(Path oebpsDir, DocumentStructure structure, List<String> pageImageNames) throws IOException {
        List<String> fileNames = new ArrayList<>();
        
        // Identify repetitive headers/footers across pages to filter them out
        Set<String> repetitiveText = identifyRepetitiveText(structure);
        
        // Create one XHTML file per page with the page image
        for (int i = 0; i < structure.getPages().size(); i++) {
            PageStructure page = structure.getPages().get(i);
            String fileName = "page_" + (i + 1) + ".xhtml";
            String imageName = i < pageImageNames.size() ? pageImageNames.get(i) : null;
            String htmlContent = generateFixedLayoutPageHTML(page, imageName, i + 1, repetitiveText);
            Files.write(oebpsDir.resolve(fileName), htmlContent.getBytes(StandardCharsets.UTF_8));
            fileNames.add(fileName);
        }
        
        return fileNames;
    }

    /**
     * Identifies text that appears on multiple pages (likely headers/footers)
     * These should be filtered to avoid TTS repetition
     */
    private Set<String> identifyRepetitiveText(DocumentStructure structure) {
        Set<String> repetitiveText = new HashSet<>();
        Map<String, Integer> textFrequency = new HashMap<>();
        
        // Count frequency of each text block across all pages
        for (PageStructure page : structure.getPages()) {
            if (page.getTextBlocks() != null) {
                for (TextBlock block : page.getTextBlocks()) {
                    if (block.getText() != null) {
                        String normalized = block.getText().trim().toLowerCase();
                        if (normalized.length() > 0 && normalized.length() < 100) {
                            // Only consider short text (likely headers/footers)
                            textFrequency.put(normalized, textFrequency.getOrDefault(normalized, 0) + 1);
                        }
                    }
                }
            }
        }
        
        // If text appears on more than 30% of pages, consider it repetitive
        int threshold = Math.max(2, structure.getPages().size() / 3);
        for (Map.Entry<String, Integer> entry : textFrequency.entrySet()) {
            if (entry.getValue() >= threshold) {
                repetitiveText.add(entry.getKey());
                logger.debug("Identified repetitive text (likely header/footer): {}", entry.getKey());
            }
        }
        
        return repetitiveText;
    }

    private List<String> getFixedLayoutContentFileNames(DocumentStructure structure) {
        List<String> fileNames = new ArrayList<>();
        for (int i = 1; i <= structure.getPages().size(); i++) {
            fileNames.add("page_" + i + ".xhtml");
        }
        return fileNames;
    }

    private List<String> getContentFileNames(DocumentStructure structure) {
        List<String> fileNames = new ArrayList<>();
        List<List<PageStructure>> chapters = groupPagesIntoChapters(structure);
        for (int i = 1; i <= chapters.size(); i++) {
            fileNames.add("chapter_" + i + ".xhtml");
        }
        return fileNames;
    }

    private List<List<PageStructure>> groupPagesIntoChapters(DocumentStructure structure) {
        List<List<PageStructure>> chapters = new ArrayList<>();
        List<PageStructure> currentChapter = new ArrayList<>();
        
        for (PageStructure page : structure.getPages()) {
            boolean isChapterStart = false;
            for (TextBlock block : page.getTextBlocks()) {
                if (block.getType() == TextBlock.BlockType.HEADING && 
                    block.getLevel() != null && block.getLevel() == 1) {
                    if (!currentChapter.isEmpty()) {
                        chapters.add(new ArrayList<>(currentChapter));
                        currentChapter.clear();
                    }
                    isChapterStart = true;
                    break;
                }
            }
            currentChapter.add(page);
        }
        
        if (!currentChapter.isEmpty()) {
            chapters.add(currentChapter);
        }
        
        return chapters;
    }

    private String generateChapterHTML(List<PageStructure> pages, DocumentStructure structure) {
        StringBuilder html = new StringBuilder();
        html.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        html.append("<!DOCTYPE html>\n");
        html.append("<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\">\n");
        html.append("<head>\n");
        html.append("  <meta charset=\"UTF-8\"/>\n");
        html.append("  <title>Chapter</title>\n");
        html.append("</head>\n");
        html.append("<body>\n");
        
        for (PageStructure page : pages) {
            for (TextBlock block : page.getTextBlocks()) {
                html.append(convertBlockToHTML(block, structure));
            }
        }
        
        html.append("</body>\n");
        html.append("</html>\n");
        
        return html.toString();
    }

    private String generateFixedLayoutPageHTML(PageStructure page, String imageName, int pageNumber) {
        return generateFixedLayoutPageHTML(page, imageName, pageNumber, new HashSet<>());
    }

    private String generateFixedLayoutPageHTML(PageStructure page, String imageName, int pageNumber, Set<String> repetitiveText) {
        StringBuilder html = new StringBuilder();
        html.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        html.append("<!DOCTYPE html>\n");
        html.append("<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\">\n");
        html.append("<head>\n");
        html.append("  <meta charset=\"UTF-8\"/>\n");
        // EPUB3 fixed-layout viewport - full screen constant display
        html.append("  <meta name=\"viewport\" content=\"width=device-width, height=device-height, initial-scale=1.0, maximum-scale=1.0, user-scalable=no\"/>\n");
        html.append("  <title>Page ").append(pageNumber).append("</title>\n");
        html.append("  <link rel=\"stylesheet\" type=\"text/css\" href=\"css/fixed-layout.css\"/>\n");
        html.append("</head>\n");
        html.append("<body class=\"fixed-layout-page\">\n");
        html.append("  <div class=\"page-container\">\n");
        
        // Page image - decorative, hidden from screen readers since text content is available
        // imageName already includes "image/" prefix from renderPdfPagesAsImages
        if (imageName != null) {
            html.append("    <img src=\"").append(escapeHtml(imageName)).append("\" alt=\"\" class=\"page-image\" aria-hidden=\"true\"/>\n");
        }
        
        // Text content for accessibility - visible to screen readers but visually hidden
        // Sort blocks by reading order for proper TTS flow
        html.append("    <div class=\"text-content\" role=\"article\" aria-label=\"Page ").append(pageNumber).append(" content\">\n");
        if (page.getTextBlocks() != null && !page.getTextBlocks().isEmpty()) {
            // Sort by reading order to ensure correct TTS flow
            // CRITICAL: This order must match SMIL generation order
            List<TextBlock> sortedBlocks = new ArrayList<>(page.getTextBlocks());
            sortedBlocks.sort((a, b) -> {
                Integer orderA = a.getReadingOrder();
                Integer orderB = b.getReadingOrder();
                // If reading order is null, use position in original list as fallback
                if (orderA == null) {
                    int indexA = page.getTextBlocks().indexOf(a);
                    orderA = indexA >= 0 ? indexA : Integer.MAX_VALUE;
                }
                if (orderB == null) {
                    int indexB = page.getTextBlocks().indexOf(b);
                    orderB = indexB >= 0 ? indexB : Integer.MAX_VALUE;
                }
                return orderA.compareTo(orderB);
            });
            
            // Filter and add blocks in reading order
            for (TextBlock block : sortedBlocks) {
                // Skip repetitive text (headers/footers)
                if (block.getText() != null && repetitiveText.contains(block.getText().trim().toLowerCase())) {
                    continue; // Skip this block as it's a repetitive header/footer
                }
                
                String htmlBlock = convertBlockToHTML(block, null);
                // Only add non-empty, meaningful blocks
                if (htmlBlock != null && !htmlBlock.trim().isEmpty()) {
                    html.append(htmlBlock);
                }
            }
        }
        // Don't add page number as it's decorative and will be read by TTS
        html.append("    </div>\n");
        
        html.append("  </div>\n");
        html.append("</body>\n");
        html.append("</html>\n");
        
        return html.toString();
    }

    private void createFixedLayoutCSS(Path oebpsDir) throws IOException {
        String css = "/* Fixed Layout EPUB Styles - Full Screen Constant Display */\n" +
            "* {\n" +
            "  margin: 0;\n" +
            "  padding: 0;\n" +
            "  box-sizing: border-box;\n" +
            "}\n\n" +
            "html, body {\n" +
            "  margin: 0;\n" +
            "  padding: 0;\n" +
            "  width: 100vw;\n" +
            "  height: 100vh;\n" +
            "  overflow: hidden;\n" +
            "  position: fixed;\n" +
            "  top: 0;\n" +
            "  left: 0;\n" +
            "}\n\n" +
            ".fixed-layout-page {\n" +
            "  margin: 0;\n" +
            "  padding: 0;\n" +
            "  overflow: hidden;\n" +
            "  width: 100vw;\n" +
            "  height: 100vh;\n" +
            "  position: fixed;\n" +
            "  top: 0;\n" +
            "  left: 0;\n" +
            "  display: block;\n" +
            "}\n\n" +
            ".page-container {\n" +
            "  position: relative;\n" +
            "  width: 100vw;\n" +
            "  height: 100vh;\n" +
            "  margin: 0;\n" +
            "  padding: 0;\n" +
            "  overflow: hidden;\n" +
            "  display: flex;\n" +
            "  align-items: center;\n" +
            "  justify-content: center;\n" +
            "  background-color: white;\n" +
            "}\n\n" +
            ".page-image {\n" +
            "  width: 100vw;\n" +
            "  height: 100vh;\n" +
            "  object-fit: contain;\n" +
            "  display: block;\n" +
            "  margin: 0;\n" +
            "  padding: 0;\n" +
            "  position: absolute;\n" +
            "  top: 50%;\n" +
            "  left: 50%;\n" +
            "  transform: translate(-50%, -50%);\n" +
            "  z-index: 1;\n" +
            "  /* Preserve full image without cropping - scale to fit viewport */\n" +
            "  object-position: center center;\n" +
            "  /* Ensure image maintains aspect ratio and fits within viewport */\n" +
            "  max-width: 100vw;\n" +
            "  max-height: 100vh;\n" +
            "}\n\n" +
            ".text-content {\n" +
            "  /* Visually hidden but accessible to screen readers and TTS */\n" +
            "  position: absolute;\n" +
            "  top: 0;\n" +
            "  left: 0;\n" +
            "  width: 1px;\n" +
            "  height: 1px;\n" +
            "  clip: rect(0, 0, 0, 0);\n" +
            "  clip-path: inset(50%);\n" +
            "  overflow: hidden;\n" +
            "  white-space: nowrap;\n" +
            "  z-index: 2;\n" +
            "  /* Ensure text is readable by TTS but not visible */\n" +
            "  color: transparent;\n" +
            "  background: transparent;\n" +
            "}\n\n" +
            ".text-content p,\n" +
            ".text-content h1,\n" +
            ".text-content h2,\n" +
            ".text-content h3,\n" +
            ".text-content h4,\n" +
            ".text-content h5,\n" +
            ".text-content h6,\n" +
            ".text-content ul,\n" +
            ".text-content ol,\n" +
            ".text-content li {\n" +
            "  margin: 0;\n" +
            "  padding: 0;\n" +
            "  display: block;\n" +
            "}\n\n" +
            ".page-number {\n" +
            "  display: none;\n" +
            "}\n\n" +
            "/* EPUB 3 Media Overlay - Highlight active text during read-aloud */\n" +
            "/* This class is applied by the EPUB reader when text is being read */\n" +
            "/* Both formats are supported for compatibility */\n" +
            ".-epub-media-overlay-active,\n" +
            ".epub-media-overlay-active,\n" +
            "*.-epub-media-overlay-active,\n" +
            "*[class*=\"-epub-media-overlay-active\"] {\n" +
            "  background-color: rgba(255, 255, 0, 0.6) !important;\n" +
            "  color: #000000 !important;\n" +
            "  outline: 3px solid #FFD700 !important;\n" +
            "  outline-offset: 1px !important;\n" +
            "  border-radius: 2px !important;\n" +
            "  box-shadow: 0 0 5px rgba(255, 215, 0, 0.5) !important;\n" +
            "}\n" +
            "/* Ensure text elements can be highlighted and are visible */\n" +
            "p, h1, h2, h3, h4, h5, h6, li, span, div[role=\"text\"], div[role=\"article\"] {\n" +
            "  position: relative !important;\n" +
            "  display: block !important;\n" +
            "  visibility: visible !important;\n" +
            "}\n" +
            "/* Make sure text content is not hidden */\n" +
            ".text-content {\n" +
            "  visibility: visible !important;\n" +
            "  display: block !important;\n" +
            "}\n";
        
        // Save CSS to css/ folder (oebpsDir is already the cssDir)
        Files.write(oebpsDir.resolve("fixed-layout.css"), css.getBytes(StandardCharsets.UTF_8));
    }

    private String convertBlockToHTML(TextBlock block, DocumentStructure structure) {
        StringBuilder html = new StringBuilder();
        
        // Clean and normalize text before using it
        String cleanedText = cleanTextForAccessibility(block.getText());
        
        // Skip empty blocks after cleaning
        if (cleanedText == null || cleanedText.trim().isEmpty()) {
            return "";
        }
        
        // Skip decorative block types that shouldn't be read by TTS
        if (block.getType() == TextBlock.BlockType.FOOTNOTE || 
            block.getType() == TextBlock.BlockType.SIDEBAR) {
            // Footnotes and sidebars can be skipped or handled separately
            // For now, skip them to avoid TTS confusion
            return "";
        }
        
        // Ensure block has a valid ID - use consistent format for SMIL sync
        String blockId = block.getId();
        if (blockId == null || blockId.isEmpty()) {
            // Generate consistent ID based on block type and reading order
            // Format: {type}_{page}_{order} or {type}_{page}_{index}
            String blockType = block.getType() != null ? block.getType().name().toLowerCase() : "block";
            Integer readingOrder = block.getReadingOrder();
            if (readingOrder != null) {
                blockId = blockType + "_" + readingOrder;
            } else {
                // Fallback: use hash of text content for consistency
                String textHash = String.valueOf(block.getText() != null ? block.getText().hashCode() : System.currentTimeMillis());
                blockId = blockType + "_" + Math.abs(textHash.hashCode());
            }
        }
        
        // Add coordinates as data attributes if available (for audio sync overlay)
        String coordinateAttrs = "";
        if (block.getBoundingBox() != null) {
            BoundingBox bbox = block.getBoundingBox();
            // Convert PDF coordinates to viewport-relative percentages or pixels
            // PDF coordinates are in points (1/72 inch), we'll store them as-is
            // The frontend can scale them based on the actual rendered image size
            coordinateAttrs = " data-x=\"" + (bbox.getX() != null ? bbox.getX() : "") + "\"";
            coordinateAttrs += " data-y=\"" + (bbox.getY() != null ? bbox.getY() : "") + "\"";
            coordinateAttrs += " data-width=\"" + (bbox.getWidth() != null ? bbox.getWidth() : "") + "\"";
            coordinateAttrs += " data-height=\"" + (bbox.getHeight() != null ? bbox.getHeight() : "") + "\"";
            // Also add as data-top and data-left for compatibility with XhtmlExtractionService
            coordinateAttrs += " data-top=\"" + (bbox.getY() != null ? bbox.getY() : "") + "\"";
            coordinateAttrs += " data-left=\"" + (bbox.getX() != null ? bbox.getX() : "") + "\"";
        }
        
        switch (block.getType()) {
            case HEADING:
                int level = block.getLevel() != null ? block.getLevel() : 2;
                // Ensure level is between 1-6
                level = Math.max(1, Math.min(6, level));
                html.append("<h").append(level).append(" id=\"").append(escapeHtml(blockId)).append("\"");
                html.append(coordinateAttrs);
                html.append(">");
                html.append(escapeHtml(cleanedText));
                html.append("</h").append(level).append(">\n");
                break;
                
            case PARAGRAPH:
                html.append("<p id=\"").append(escapeHtml(blockId)).append("\"");
                html.append(coordinateAttrs);
                html.append(">");
                html.append(escapeHtml(cleanedText));
                html.append("</p>\n");
                break;
                
            case LIST_ITEM:
            case LIST_UNORDERED:
                html.append("<ul id=\"").append(escapeHtml(blockId)).append("\"");
                html.append(coordinateAttrs);
                html.append(">");
                // List items need their own IDs for SMIL synchronization
                String liId = blockId + "_li";
                html.append("<li id=\"").append(escapeHtml(liId)).append("\">").append(escapeHtml(cleanedText)).append("</li>");
                html.append("</ul>\n");
                break;
                
            case LIST_ORDERED:
                html.append("<ol id=\"").append(escapeHtml(blockId)).append("\"");
                html.append(coordinateAttrs);
                html.append(">");
                // List items need their own IDs for SMIL synchronization
                String oliId = blockId + "_li";
                html.append("<li id=\"").append(escapeHtml(oliId)).append("\">").append(escapeHtml(cleanedText)).append("</li>");
                html.append("</ol>\n");
                break;
                
            case CAPTION:
                html.append("<p id=\"").append(escapeHtml(blockId)).append("\" class=\"caption\"");
                html.append(coordinateAttrs);
                html.append(">");
                html.append(escapeHtml(cleanedText));
                html.append("</p>\n");
                break;
                
            default:
                html.append("<p id=\"").append(escapeHtml(blockId)).append("\"");
                html.append(coordinateAttrs);
                html.append(">");
                html.append(escapeHtml(cleanedText));
                html.append("</p>\n");
        }
        
        return html.toString();
    }

    /**
     * Cleans text to remove binary data, non-printable characters, and normalize for accessibility
     * Also filters out headers, footers, page numbers, and other decorative text
     */
    private String cleanTextForAccessibility(String text) {
        if (text == null || text.isEmpty()) {
            return "";
        }
        
        // First, remove escape sequences like \24, \n, \r, \t, etc.
        // These are being read literally by TTS as "backslash 24" etc.
        String cleaned = text;
        
        // Remove escape sequences: \ followed by digits (like \24, \1, \123)
        cleaned = cleaned.replaceAll("\\\\\\d+", " ");
        
        // Remove escape sequences: \ followed by letters (like \n, \r, \t, \a, etc.)
        cleaned = cleaned.replaceAll("\\\\[a-zA-Z]", " ");
        
        // Remove backslashes that aren't part of valid escape sequences
        cleaned = cleaned.replaceAll("\\\\", " ");
        
        // Remove control characters (0x00-0x1F) except common whitespace
        cleaned = cleaned.replaceAll("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]", "");
        
        // Remove other non-printable Unicode characters
        cleaned = cleaned.replaceAll("[\\p{Cc}\\p{Cf}\\p{Co}\\p{Cn}]", "");
        
        StringBuilder result = new StringBuilder();
        
        for (char c : cleaned.toCharArray()) {
            // Keep only printable characters, whitespace, and common punctuation
            if (Character.isLetterOrDigit(c) || 
                Character.isWhitespace(c) || 
                isPrintablePunctuation(c) ||
                (c >= 0x00A0 && c <= 0xFFFF && Character.isDefined(c) && Character.isLetterOrDigit(c))) {
                result.append(c);
            } else if (c == '\n' || c == '\r' || c == '\t') {
                // Normalize whitespace
                result.append(' ');
            }
            // Skip all other characters
        }
        
        // Normalize multiple spaces to single space
        String normalized = result.toString().replaceAll("\\s+", " ").trim();
        
        // Filter out common header/footer patterns and page numbers
        normalized = filterDecorativeText(normalized);
        
        // Remove lines that look like binary data or garbled text
        if (normalized.length() > 0) {
            long letterCount = normalized.chars().filter(Character::isLetter).count();
            long digitCount = normalized.chars().filter(Character::isDigit).count();
            long totalCount = normalized.chars().filter(c -> !Character.isWhitespace(c)).count();
            
            // Check if text is mostly binary-like patterns
            boolean hasBinaryPattern = normalized.matches(".*[01]{4,}.*") || // Binary patterns like "0101"
                                      normalized.matches(".*[\\x00-\\x1F]{2,}.*"); // Control characters
            
            // If less than 30% are letters/digits, it's likely binary/garbled data
            // Also check for suspicious patterns
            if (totalCount > 0) {
                double alphaNumericRatio = (double) (letterCount + digitCount) / totalCount;
                
                // More lenient for short text (might be numbers, dates, etc.)
                double threshold = normalized.length() > 10 ? 0.3 : 0.2;
                
                if ((alphaNumericRatio < threshold || hasBinaryPattern) && normalized.length() > 5) {
                    return ""; // Skip this text block
                }
            }
            
            // Remove common OCR artifacts and garbled patterns
            normalized = normalized.replaceAll("[|]{2,}", " ") // Multiple pipes
                                   .replaceAll("[~]{2,}", " ") // Multiple tildes
                                   .replaceAll("[_]{3,}", " ") // Multiple underscores
                                   .replaceAll("\\\\", "") // Remove any remaining backslashes
                                   .replaceAll("\\s+", " ") // Multiple spaces
                                   .trim();
            
            // Final check: if text contains words like "backslash", "slash", or escape-like patterns, filter it
            if (normalized.toLowerCase().matches(".*(backslash|slash|escape|\\\\).*")) {
                // If it mentions escape sequences, it's likely corrupted text
                return "";
            }
        }
        
        return normalized;
    }

    /**
     * Filters out decorative text like headers, footers, page numbers, etc.
     * These should not be read by TTS as they're visual-only elements
     */
    private String filterDecorativeText(String text) {
        if (text == null || text.isEmpty()) {
            return "";
        }
        
        String lowerText = text.toLowerCase().trim();
        
        // Filter out page number patterns
        if (lowerText.matches("^page\\s+\\d+$") || 
            lowerText.matches("^\\d+$") && text.length() < 5) {
            return ""; // Skip standalone page numbers
        }
        
        // Filter out common header/footer patterns
        if (lowerText.matches("^(chapter|section|part)\\s+\\d+.*") && text.length() < 50) {
            // Keep chapter headers but filter very short ones that are likely decorative
            if (text.length() < 20) {
                return "";
            }
        }
        
        // Filter out table of contents entries (usually short with page numbers)
        if (lowerText.matches(".*\\.{3,}\\s*\\d+$") && text.length() < 80) {
            return ""; // Skip TOC entries
        }
        
        // Filter out very short text that's likely decorative (watermarks, etc.)
        if (text.length() < 3 && !text.matches("^[A-Za-z]$")) {
            return "";
        }
        
        // Filter out text that's mostly symbols or special characters
        long symbolCount = text.chars().filter(c -> !Character.isLetterOrDigit(c) && !Character.isWhitespace(c)).count();
        if (text.length() > 0 && (double) symbolCount / text.length() > 0.5 && text.length() < 20) {
            return ""; // Mostly symbols, likely decorative
        }
        
        return text;
    }

    /**
     * Checks if character is printable punctuation
     * Note: Backslash (\) is excluded as it's often part of escape sequences
     */
    private boolean isPrintablePunctuation(char c) {
        return (c >= 0x21 && c <= 0x2F) ||  // ! " # $ % & ' ( ) * + , - . /
               (c >= 0x3A && c <= 0x40) ||  // : ; < = > ? @
               (c == 0x5B || c == 0x5D || c >= 0x5E && c <= 0x60) ||  // [ ] ^ _ ` (excluding backslash)
               (c >= 0x7B && c <= 0x7E) ||  // { | } ~
               c == 0xA0 || c == 0x2013 || c == 0x2014 || // Non-breaking space, en-dash, em-dash
               c == 0x2018 || c == 0x2019 || c == 0x201C || c == 0x201D || // Smart quotes
               c == 0x2026; // Ellipsis
        // Explicitly exclude backslash (0x5C) as it's problematic for TTS
    }

    private String escapeHtml(String text) {
        if (text == null) return "";
        return text.replace("&", "&amp;")
                   .replace("<", "&lt;")
                   .replace(">", "&gt;")
                   .replace("\"", "&quot;")
                   .replace("'", "&#39;");
    }

    private String escapeXml(String text) {
        if (text == null) return "";
        return text.replace("&", "&amp;")
                   .replace("<", "&lt;")
                   .replace(">", "&gt;")
                   .replace("\"", "&quot;")
                   .replace("'", "&apos;");
    }

    private void copyImages(Path oebpsDir, DocumentStructure structure) throws IOException {
        if (structure.getImages() == null) return;
        
        for (ImageReference image : structure.getImages()) {
            String sourcePath = image.getOriginalPath();
            if (sourcePath != null && new File(sourcePath).exists()) {
                String imageName = new File(sourcePath).getName();
                Files.copy(Paths.get(sourcePath), oebpsDir.resolve(imageName));
            }
        }
    }

    private void createEpubZip(Path tempDir, String epubPath) throws IOException {
        ZipFile zipFile = new ZipFile(epubPath);
        
        // Add mimetype first, uncompressed (EPUB spec requirement)
        ZipParameters mimetypeParams = new ZipParameters();
        mimetypeParams.setCompressionMethod(net.lingala.zip4j.model.enums.CompressionMethod.STORE);
        mimetypeParams.setFileNameInZip("mimetype");
        zipFile.addFile(tempDir.resolve("mimetype").toFile(), mimetypeParams);
        
        // Add all other files with compression
        ZipParameters parameters = new ZipParameters();
        parameters.setCompressionMethod(net.lingala.zip4j.model.enums.CompressionMethod.DEFLATE);
        
        // Add META-INF
        addDirectoryToZip(zipFile, tempDir.resolve("META-INF"), parameters);
        
        // Add OEBPS
        addDirectoryToZip(zipFile, tempDir.resolve("OEBPS"), parameters);
    }

    private void addDirectoryToZip(ZipFile zipFile, Path directory, ZipParameters parameters) throws IOException {
        Path tempDir = directory.getParent();
        Files.walk(directory).forEach(path -> {
            if (Files.isRegularFile(path)) {
                try {
                    // Calculate relative path from tempDir to preserve directory structure
                    String entryName = tempDir.relativize(path).toString().replace("\\", "/");
                    ZipParameters fileParams = new ZipParameters();
                    fileParams.setCompressionMethod(parameters.getCompressionMethod());
                    fileParams.setFileNameInZip(entryName);
                    zipFile.addFile(path.toFile(), fileParams);
                } catch (IOException e) {
                    logger.error("Failed to add file to ZIP: " + path, e);
                }
            }
        });
    }

    /**
     * Copies audio file to EPUB package
     */
    private String copyAudioFile(File audioFile, Path audioDir) throws IOException {
        String audioFileName = "audio_" + UUID.randomUUID().toString();
        String originalName = audioFile.getName();
        String extension = "";
        if (originalName.contains(".")) {
            extension = originalName.substring(originalName.lastIndexOf("."));
        } else {
            // Default to mp3 if no extension
            extension = ".mp3";
        }
        audioFileName += extension;
        
        Path audioPath = audioDir.resolve(audioFileName);
        Files.copy(audioFile.toPath(), audioPath, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        logger.info("Audio file copied to EPUB: {}", audioPath);
        // Return path relative to OEBPS (audio/filename.ext)
        return "audio/" + audioFileName;
    }

    /**
     * Generates SMIL files for media overlay synchronization
     */
    private List<String> generateSmilFiles(Path oebpsDir, List<AudioSync> audioSyncs, 
                                          String audioFileName, DocumentStructure structure) throws IOException {
        List<String> smilFileNames = new ArrayList<>();
        
        // Group syncs by page number (can have multiple syncs per page for block-level syncs)
        Map<Integer, List<AudioSync>> syncsByPage = audioSyncs.stream()
            .collect(Collectors.groupingBy(AudioSync::getPageNumber));
        
        // Generate SMIL file for each page that has audio syncs
        for (int i = 0; i < structure.getPages().size(); i++) {
            int pageNumber = i + 1;
            List<AudioSync> pageSyncs = syncsByPage.get(pageNumber);
            
            if (pageSyncs != null && !pageSyncs.isEmpty()) {
                String smilFileName = "page_" + pageNumber + ".smil";
                String smilContent = generateSmilContent(pageNumber, pageSyncs, audioFileName, structure);
                Files.write(oebpsDir.resolve(smilFileName), smilContent.getBytes(StandardCharsets.UTF_8));
                smilFileNames.add(smilFileName);
                logger.debug("Generated SMIL file for page {} with {} syncs: {}", pageNumber, pageSyncs.size(), smilFileName);
            }
        }
        
        return smilFileNames;
    }

    /**
     * Generates SMIL content for a single page with proper EPUB 3 Read-Aloud structure
     * Creates multiple <par> elements for each text block, sequenced with <seq>
     * Supports both block-level syncs (with blockId) and page-level syncs (proportional distribution)
     */
    private String generateSmilContent(int pageNumber, List<AudioSync> pageSyncs, String audioFileName, 
                                       DocumentStructure structure) {
        StringBuilder smil = new StringBuilder();
        smil.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        smil.append("<smil xmlns=\"http://www.w3.org/ns/SMIL\" version=\"3.0\">\n");
        smil.append("  <body>\n");
        smil.append("    <seq>\n");
        
        // Get text blocks for this page
        PageStructure page = null;
        if (structure != null && structure.getPages() != null && pageNumber <= structure.getPages().size()) {
            page = structure.getPages().get(pageNumber - 1);
        }
        
        // Check if we have block-level syncs (syncs with blockId)
        final PageStructure finalPage = page; // Make final for lambda
        List<AudioSync> blockLevelSyncs = pageSyncs.stream()
            .filter(s -> s.getBlockId() != null && !s.getBlockId().isEmpty())
            .sorted((a, b) -> {
                // Sort by reading order if available, otherwise by start time
                if (finalPage != null && finalPage.getTextBlocks() != null) {
                    int orderA = getBlockReadingOrder(finalPage, a.getBlockId());
                    int orderB = getBlockReadingOrder(finalPage, b.getBlockId());
                    if (orderA != orderB) return Integer.compare(orderA, orderB);
                }
                return Double.compare(a.getStartTime(), b.getStartTime());
            })
            .collect(java.util.stream.Collectors.toList());
        
        List<AudioSync> pageLevelSyncs = pageSyncs.stream()
            .filter(s -> s.getBlockId() == null || s.getBlockId().isEmpty())
            .collect(java.util.stream.Collectors.toList());
        
        if (!blockLevelSyncs.isEmpty()) {
            // Use block-level syncs - create one <par> per sync
            // CRITICAL: Sort by reading order to match XHTML order
            blockLevelSyncs.sort((a, b) -> {
                if (finalPage != null && finalPage.getTextBlocks() != null) {
                    int orderA = getBlockReadingOrder(finalPage, a.getBlockId());
                    int orderB = getBlockReadingOrder(finalPage, b.getBlockId());
                    if (orderA != orderB) return Integer.compare(orderA, orderB);
                }
                return Double.compare(a.getStartTime(), b.getStartTime());
            });
            
            int parIndex = 0;
            for (AudioSync sync : blockLevelSyncs) {
                String blockId = sync.getBlockId();
                
                // For list items, ensure ID matches XHTML structure (with _li suffix)
                if (finalPage != null && finalPage.getTextBlocks() != null) {
                    for (TextBlock block : finalPage.getTextBlocks()) {
                        if (blockId.equals(block.getId()) && 
                            (block.getType() == TextBlock.BlockType.LIST_ITEM ||
                             block.getType() == TextBlock.BlockType.LIST_UNORDERED ||
                             block.getType() == TextBlock.BlockType.LIST_ORDERED)) {
                            blockId = blockId + "_li";
                            break;
                        }
                    }
                }
                
                smil.append("      <par id=\"par-").append(pageNumber).append("-").append(parIndex++).append("\">\n");
                smil.append("        <text src=\"page_").append(pageNumber).append(".xhtml#").append(escapeXml(blockId)).append("\"/>\n");
                smil.append("        <audio src=\"").append(escapeXml(audioFileName))
                    .append("\" clipBegin=\"").append(formatSmilTime(sync.getStartTime()))
                    .append("\" clipEnd=\"").append(formatSmilTime(sync.getEndTime())).append("\"/>\n");
                smil.append("      </par>\n");
            }
        } else if (!pageLevelSyncs.isEmpty() && page != null && page.getTextBlocks() != null && !page.getTextBlocks().isEmpty()) {
            // Use page-level syncs - distribute proportionally
            // Use the first page-level sync (or combine if multiple)
            AudioSync sync = pageLevelSyncs.get(0);
            
            // CRITICAL: Sort blocks by reading order to match XHTML order
            List<TextBlock> blocks = new ArrayList<>(page.getTextBlocks());
            blocks.sort((a, b) -> {
                Integer orderA = a.getReadingOrder();
                Integer orderB = b.getReadingOrder();
                if (orderA == null) orderA = Integer.MAX_VALUE;
                if (orderB == null) orderB = Integer.MAX_VALUE;
                return orderA.compareTo(orderB);
            });
            
            double totalDuration = sync.getEndTime() - sync.getStartTime();
            double timePerBlock = totalDuration / blocks.size();
            
            int blockIndex = 0;
            for (TextBlock block : blocks) {
                // Generate ID using same logic as convertBlockToHTML
                String blockId = block.getId();
                if (blockId == null || blockId.isEmpty()) {
                    String blockType = block.getType() != null ? block.getType().name().toLowerCase() : "block";
                    Integer readingOrder = block.getReadingOrder();
                    if (readingOrder != null) {
                        blockId = blockType + "_" + readingOrder;
                    } else {
                        String textHash = String.valueOf(block.getText() != null ? block.getText().hashCode() : blockIndex);
                        blockId = blockType + "_" + Math.abs(textHash.hashCode());
                    }
                }
                
                // For list items, append "_li" to match XHTML structure
                if (block.getType() == TextBlock.BlockType.LIST_ITEM || 
                    block.getType() == TextBlock.BlockType.LIST_UNORDERED ||
                    block.getType() == TextBlock.BlockType.LIST_ORDERED) {
                    blockId = blockId + "_li";
                }
                
                double blockStartTime = sync.getStartTime() + (blockIndex * timePerBlock);
                double blockEndTime = sync.getStartTime() + ((blockIndex + 1) * timePerBlock);
                
                if (blockIndex == blocks.size() - 1) {
                    blockEndTime = sync.getEndTime();
                }
                
                smil.append("      <par id=\"par-").append(pageNumber).append("-").append(blockIndex + 1).append("\">\n");
                smil.append("        <text src=\"page_").append(pageNumber).append(".xhtml#").append(escapeXml(blockId)).append("\"/>\n");
                smil.append("        <audio src=\"").append(escapeXml(audioFileName))
                    .append("\" clipBegin=\"").append(formatSmilTime(blockStartTime))
                    .append("\" clipEnd=\"").append(formatSmilTime(blockEndTime)).append("\"/>\n");
                smil.append("      </par>\n");
                
                blockIndex++;
            }
        } else {
            // Fallback: single par for entire page
            AudioSync sync = pageSyncs.get(0);
            smil.append("      <par id=\"page").append(pageNumber).append("-par\">\n");
            smil.append("        <text src=\"page_").append(pageNumber).append(".xhtml#page").append(pageNumber).append("\"/>\n");
            smil.append("        <audio src=\"").append(escapeXml(audioFileName))
                .append("\" clipBegin=\"").append(formatSmilTime(sync.getStartTime()))
                .append("\" clipEnd=\"").append(formatSmilTime(sync.getEndTime())).append("\"/>\n");
            smil.append("      </par>\n");
        }
        
        smil.append("    </seq>\n");
        smil.append("  </body>\n");
        smil.append("</smil>\n");
        return smil.toString();
    }
    
    /**
     * Gets the reading order of a text block by its ID
     */
    private int getBlockReadingOrder(PageStructure page, String blockId) {
        if (page.getTextBlocks() != null) {
            for (int i = 0; i < page.getTextBlocks().size(); i++) {
                TextBlock block = page.getTextBlocks().get(i);
                if (blockId.equals(block.getId())) {
                    return block.getReadingOrder() != null ? block.getReadingOrder() : i + 1;
                }
            }
        }
        return Integer.MAX_VALUE;
    }

    /**
     * Formats time in seconds to SMIL time format (HH:MM:SS.mmm)
     */
    private String formatSmilTime(double seconds) {
        int hours = (int) (seconds / 3600);
        int minutes = (int) ((seconds % 3600) / 60);
        int secs = (int) (seconds % 60);
        int millis = (int) ((seconds % 1) * 1000);
        return String.format("%02d:%02d:%02d.%03d", hours, minutes, secs, millis);
    }

    /**
     * Updates content.opf to include audio file and SMIL files, and set media overlay
     */
    private void updateContentOpfForAudio(Path oebpsDir, String audioFileName, List<String> smilFileNames,
                                         DocumentStructure structure, List<String> pageImageNames, 
                                         List<AudioSync> audioSyncs) throws IOException {
        Path opfPath = oebpsDir.resolve("content.opf");
        String opfContent = new String(Files.readAllBytes(opfPath), StandardCharsets.UTF_8);
        
        // Determine audio MIME type
        String audioMimeType = "audio/mpeg"; // Default to MP3
        if (audioFileName.endsWith(".wav")) {
            audioMimeType = "audio/wav";
        } else if (audioFileName.endsWith(".ogg")) {
            audioMimeType = "audio/ogg";
        } else if (audioFileName.endsWith(".m4a")) {
            audioMimeType = "audio/mp4";
        }
        
        // Find manifest section and add audio file
        int manifestEndIndex = opfContent.indexOf("  </manifest>");
        if (manifestEndIndex > 0) {
            StringBuilder newManifest = new StringBuilder();
            newManifest.append(opfContent.substring(0, manifestEndIndex));
            // audioFileName already includes "audio/" prefix from copyAudioFile
            newManifest.append("    <item id=\"audio\" href=\"").append(escapeXml(audioFileName))
                .append("\" media-type=\"").append(audioMimeType).append("\"/>\n");
            
            // Add SMIL files
            for (String smilFileName : smilFileNames) {
                int pageNum = extractPageNumber(smilFileName);
                newManifest.append("    <item id=\"smil-page").append(pageNum)
                    .append("\" href=\"").append(escapeXml(smilFileName))
                    .append("\" media-type=\"application/smil+xml\"/>\n");
            }
            
            newManifest.append(opfContent.substring(manifestEndIndex));
            opfContent = newManifest.toString();
        }
        
        // Update metadata to include media overlay
        int metadataEndIndex = opfContent.indexOf("  </metadata>");
        if (metadataEndIndex > 0) {
            StringBuilder newMetadata = new StringBuilder();
            newMetadata.append(opfContent.substring(0, metadataEndIndex));
            
            // Calculate total audio duration from all syncs
            double totalDuration = 0.0;
            if (audioSyncs != null && !audioSyncs.isEmpty()) {
                for (AudioSync sync : audioSyncs) {
                    double duration = sync.getEndTime() - sync.getStartTime();
                    totalDuration += duration;
                }
            }
            String durationStr = formatSmilTime(totalDuration);
            
            // EPUB 3 Media Overlay metadata - specifies CSS class for highlighting
            // The class name must match what's in the CSS file
            newMetadata.append("    <meta property=\"media:active-class\">-epub-media-overlay-active</meta>\n");
            newMetadata.append("    <meta property=\"media:duration\">").append(durationStr).append("</meta>\n");
            newMetadata.append("    <meta property=\"media:playback-active-class\">-epub-media-overlay-playing</meta>\n");
            newMetadata.append(opfContent.substring(metadataEndIndex));
            opfContent = newMetadata.toString();
        }
        
        // Update spine items to reference SMIL files
        int spineStartIndex = opfContent.indexOf("  <spine");
        int spineEndIndex = opfContent.indexOf("  </spine>");
        if (spineStartIndex > 0 && spineEndIndex > 0) {
            String beforeSpine = opfContent.substring(0, spineStartIndex);
            String spineContent = opfContent.substring(spineStartIndex, spineEndIndex);
            String afterSpine = opfContent.substring(spineEndIndex);
            
            StringBuilder newSpine = new StringBuilder();
            newSpine.append(beforeSpine);
            
            // Update each itemref to include media-overlay
            String[] lines = spineContent.split("\n");
            for (String line : lines) {
                if (line.contains("<itemref")) {
                    // Extract page number from itemref
                    int pageNum = extractPageNumberFromItemref(line);
                    if (pageNum > 0 && smilFileNames.stream().anyMatch(f -> f.contains("page_" + pageNum))) {
                        // Add media-overlay attribute before closing tag
                        if (line.contains("/>")) {
                            line = line.replace("/>", " media-overlay=\"smil-page" + pageNum + "\"/>");
                        } else if (line.contains(">")) {
                            line = line.replace(">", " media-overlay=\"smil-page" + pageNum + "\">");
                        }
                    }
                }
                newSpine.append(line);
                if (!line.endsWith("\n")) {
                    newSpine.append("\n");
                }
            }
            
            newSpine.append(afterSpine);
            opfContent = newSpine.toString();
        }
        
        Files.write(opfPath, opfContent.getBytes(StandardCharsets.UTF_8));
        logger.info("Updated content.opf with audio and SMIL files");
    }

    /**
     * Extracts page number from SMIL filename (e.g., "page_5.smil" -> 5)
     */
    private int extractPageNumber(String fileName) {
        try {
            String name = fileName.replace(".smil", "");
            return Integer.parseInt(name.substring(name.lastIndexOf("_") + 1));
        } catch (Exception e) {
            return 0;
        }
    }

    /**
     * Extracts page number from itemref line
     */
    private int extractPageNumberFromItemref(String line) {
        try {
            int idrefIndex = line.indexOf("idref=\"page");
            if (idrefIndex > 0) {
                int start = idrefIndex + 11; // "idref=\"page".length()
                int end = line.indexOf("\"", start);
                if (end > start) {
                    return Integer.parseInt(line.substring(start, end));
                }
            }
        } catch (Exception e) {
            // Ignore
        }
        return 0;
    }

    /**
     * Updates content XHTML files to include ID for SMIL synchronization
     */
    private void updateContentFilesForAudio(Path oebpsDir, List<String> smilFileNames, 
                                           DocumentStructure structure) throws IOException {
        for (String smilFileName : smilFileNames) {
            int pageNum = extractPageNumber(smilFileName);
            String xhtmlFileName = "page_" + pageNum + ".xhtml";
            Path xhtmlPath = oebpsDir.resolve(xhtmlFileName);
            
            if (Files.exists(xhtmlPath)) {
                String xhtmlContent = new String(Files.readAllBytes(xhtmlPath), StandardCharsets.UTF_8);
                
                // Parse XHTML to ensure all elements have IDs for SMIL synchronization
                try {
                    org.jsoup.nodes.Document doc = org.jsoup.Jsoup.parse(xhtmlContent, "UTF-8");
                    doc.outputSettings().syntax(org.jsoup.nodes.Document.OutputSettings.Syntax.xml);
                    doc.outputSettings().escapeMode(org.jsoup.nodes.Entities.EscapeMode.xhtml);
                    
                    // Ensure body has ID
                    org.jsoup.nodes.Element body = doc.body();
                    if (body != null && body.id().isEmpty()) {
                        body.attr("id", "page" + pageNum);
                    }
                    
                    // Ensure all text elements (p, h1-h6, li) have IDs for SMIL synchronization
                    // This is critical for text highlighting during audio playback
                    // IMPORTANT: Only add IDs if missing - don't overwrite existing IDs that match SMIL
                    org.jsoup.select.Elements textElements = doc.select("p, h1, h2, h3, h4, h5, h6, li, span[role=text], div[role=text]");
                    int idCounter = 1;
                    for (org.jsoup.nodes.Element elem : textElements) {
                        if (elem.id().isEmpty()) {
                            // Generate ID based on element type and position
                            // Try to match the format used in convertBlockToHTML
                            String elementType = elem.tagName();
                            
                            // Check if parent has reading order info
                            String parentId = elem.parent() != null ? elem.parent().id() : "";
                            Integer readingOrder = null;
                            if (parentId.contains("_")) {
                                try {
                                    String[] parts = parentId.split("_");
                                    if (parts.length > 1) {
                                        readingOrder = Integer.parseInt(parts[parts.length - 1]);
                                    }
                                } catch (Exception e) {
                                    // Ignore
                                }
                            }
                            
                            String newId;
                            if (readingOrder != null) {
                                newId = elementType + "_" + readingOrder;
                            } else {
                                newId = elementType + "_" + pageNum + "_" + idCounter++;
                            }
                            elem.attr("id", newId);
                            logger.debug("Added ID {} to {} element in page {}", newId, elementType, pageNum);
                        } else {
                            logger.debug("Element already has ID: {} in page {}", elem.id(), pageNum);
                        }
                    }
                    
                    xhtmlContent = doc.html();
                } catch (Exception e) {
                    logger.warn("Failed to parse XHTML for ID updates, using regex fallback: {}", e.getMessage());
                    
                    // Fallback: Add ID to body if missing
                if (xhtmlContent.contains("<body") && !xhtmlContent.contains("id=\"page" + pageNum + "\"")) {
                    if (xhtmlContent.contains("<body ")) {
                        xhtmlContent = xhtmlContent.replaceFirst("<body([^>]*)>", 
                            "<body$1 id=\"page" + pageNum + "\">");
                    } else {
                        xhtmlContent = xhtmlContent.replace("<body>", "<body id=\"page" + pageNum + "\">");
                    }
                    }
                }
                
                Files.write(xhtmlPath, xhtmlContent.getBytes(StandardCharsets.UTF_8));
                logger.debug("Updated {} with SMIL synchronization IDs", xhtmlFileName);
            }
        }
    }

    private void deleteDirectory(Path directory) {
        try {
            if (Files.exists(directory)) {
                Files.walk(directory)
                    .sorted((a, b) -> b.compareTo(a))
                    .forEach(path -> {
                        try {
                            Files.delete(path);
                        } catch (IOException e) {
                            logger.warn("Failed to delete: " + path, e);
                        }
                    });
            }
        } catch (IOException e) {
            logger.warn("Failed to delete directory: " + directory, e);
        }
    }
    
    /**
     * Generates intermediate HTML files from DocumentStructure
     * These HTML files can be used for debugging, preview, or manual editing
     * 
     * @param structure The document structure
     * @param pageImageNames List of page image file names
     * @param fileName Base file name for output
     * @return Path to the directory containing generated HTML files
     */
    private Path generateIntermediateHtmlFiles(DocumentStructure structure, List<String> pageImageNames, String fileName) throws IOException {
        Path htmlDir = Paths.get(htmlIntermediateDir).resolve(fileName + "_html");
        Files.createDirectories(htmlDir);
        
        // Identify repetitive headers/footers
        Set<String> repetitiveText = identifyRepetitiveText(structure);
        
        // Generate HTML file for each page
        for (int i = 0; i < structure.getPages().size(); i++) {
            PageStructure page = structure.getPages().get(i);
            String htmlFileName = "page_" + (i + 1) + ".html";
            String imageName = i < pageImageNames.size() ? pageImageNames.get(i) : null;
            String htmlContent = generateIntermediatePageHTML(page, imageName, i + 1, repetitiveText);
            Files.write(htmlDir.resolve(htmlFileName), htmlContent.getBytes(StandardCharsets.UTF_8));
        }
        
        logger.info("Generated {} intermediate HTML files in {}", structure.getPages().size(), htmlDir);
        return htmlDir;
    }
    
    /**
     * Generates HTML content for a single page (intermediate format, not XHTML)
     * This is standard HTML5 without XML declaration or XHTML namespace
     */
    private String generateIntermediatePageHTML(PageStructure page, String imageName, int pageNumber, Set<String> repetitiveText) {
        StringBuilder html = new StringBuilder();
        html.append("<!DOCTYPE html>\n");
        html.append("<html lang=\"en\">\n");
        html.append("<head>\n");
        html.append("  <meta charset=\"UTF-8\">\n");
        html.append("  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n");
        html.append("  <title>Page ").append(pageNumber).append("</title>\n");
        html.append("  <style>\n");
        html.append("    body { font-family: Arial, sans-serif; margin: 20px; }\n");
        html.append("    .page-image { max-width: 100%; height: auto; margin-bottom: 20px; }\n");
        html.append("    .text-content { margin-top: 20px; }\n");
        html.append("    .text-content p, .text-content h1, .text-content h2, .text-content h3 { margin: 10px 0; }\n");
        html.append("  </style>\n");
        html.append("</head>\n");
        html.append("<body>\n");
        html.append("  <div class=\"page-container\">\n");
        
        // Page image
        if (imageName != null) {
            html.append("    <img src=\"").append(escapeHtml(imageName)).append("\" alt=\"Page ").append(pageNumber).append("\" class=\"page-image\">\n");
        }
        
        // Text content
        html.append("    <div class=\"text-content\">\n");
        if (page.getTextBlocks() != null && !page.getTextBlocks().isEmpty()) {
            // Sort by reading order
            List<TextBlock> sortedBlocks = new ArrayList<>(page.getTextBlocks());
            sortedBlocks.sort((a, b) -> {
                Integer orderA = a.getReadingOrder();
                Integer orderB = b.getReadingOrder();
                if (orderA == null) orderA = Integer.MAX_VALUE;
                if (orderB == null) orderB = Integer.MAX_VALUE;
                return orderA.compareTo(orderB);
            });
            
            // Add blocks
            for (TextBlock block : sortedBlocks) {
                // Skip repetitive text
                if (block.getText() != null && repetitiveText.contains(block.getText().trim().toLowerCase())) {
                    continue;
                }
                
                String htmlBlock = convertBlockToHTML(block, null);
                if (htmlBlock != null && !htmlBlock.trim().isEmpty()) {
                    html.append(htmlBlock);
                }
            }
        }
        html.append("    </div>\n");
        
        html.append("  </div>\n");
        html.append("</body>\n");
        html.append("</html>\n");
        
        return html.toString();
    }
    
    /**
     * Converts HTML files to XHTML format for EPUB
     * Reads HTML files from intermediate directory and converts them to XHTML
     * 
     * @param htmlDir Directory containing HTML files
     * @param oebpsDir OEBPS directory for EPUB
     * @param structure Document structure
     * @param pageImageNames List of page image names
     * @return List of generated XHTML file names
     */
    private List<String> convertHtmlToXhtml(Path htmlDir, Path oebpsDir, DocumentStructure structure, List<String> pageImageNames) throws IOException {
        List<String> xhtmlFileNames = new ArrayList<>();
        
        // Identify repetitive text
        Set<String> repetitiveText = identifyRepetitiveText(structure);
        
        // Convert each HTML file to XHTML
        for (int i = 0; i < structure.getPages().size(); i++) {
            String htmlFileName = "page_" + (i + 1) + ".html";
            String xhtmlFileName = "page_" + (i + 1) + ".xhtml";
            Path htmlPath = htmlDir.resolve(htmlFileName);
            
            String xhtmlContent;
            if (Files.exists(htmlPath)) {
                // Read HTML file and convert to XHTML
                String htmlContent = new String(Files.readAllBytes(htmlPath), StandardCharsets.UTF_8);
                xhtmlContent = convertHtmlStringToXhtml(htmlContent, i + 1, pageImageNames);
            } else {
                // Fallback: generate XHTML directly if HTML file doesn't exist
                logger.warn("HTML file not found: {}, generating XHTML directly", htmlPath);
                PageStructure page = structure.getPages().get(i);
                String imageName = i < pageImageNames.size() ? pageImageNames.get(i) : null;
                xhtmlContent = generateFixedLayoutPageHTML(page, imageName, i + 1, repetitiveText);
            }
            
            // Write XHTML file
            Files.write(oebpsDir.resolve(xhtmlFileName), xhtmlContent.getBytes(StandardCharsets.UTF_8));
            xhtmlFileNames.add(xhtmlFileName);
        }
        
        logger.info("Converted {} HTML files to XHTML", xhtmlFileNames.size());
        return xhtmlFileNames;
    }
    
    /**
     * Converts HTML string to XHTML format
     * Adds XML declaration, XHTML namespace, and ensures proper XHTML structure
     */
    private String convertHtmlStringToXhtml(String htmlContent, int pageNumber, List<String> pageImageNames) {
        // Remove existing DOCTYPE and html tag
        String cleaned = htmlContent
            .replaceFirst("<!DOCTYPE[^>]*>", "")
            .replaceFirst("<html[^>]*>", "")
            .replaceFirst("</html>", "");
        
        // Build XHTML structure
        StringBuilder xhtml = new StringBuilder();
        xhtml.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        xhtml.append("<!DOCTYPE html>\n");
        xhtml.append("<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\">\n");
        
        // Extract and convert head section
        if (cleaned.contains("<head>")) {
            int headStart = cleaned.indexOf("<head>");
            int headEnd = cleaned.indexOf("</head>") + 7;
            String headContent = cleaned.substring(headStart, headEnd);
            // Convert HTML meta tags to XHTML format (self-closing)
            headContent = headContent.replaceAll("<meta([^>]*[^/])>", "<meta$1/>");
            headContent = headContent.replaceAll("<link([^>]*[^/])>", "<link$1/>");
            // Add EPUB-specific viewport if not present
            if (!headContent.contains("viewport")) {
                headContent = headContent.replace("</head>", 
                    "  <meta name=\"viewport\" content=\"width=device-width, height=device-height, initial-scale=1.0, maximum-scale=1.0, user-scalable=no\"/>\n" +
                    "  <link rel=\"stylesheet\" type=\"text/css\" href=\"fixed-layout.css\"/>\n" +
                    "</head>");
            }
            xhtml.append(headContent);
        } else {
            // Create head if missing
            xhtml.append("<head>\n");
            xhtml.append("  <meta charset=\"UTF-8\"/>\n");
            xhtml.append("  <meta name=\"viewport\" content=\"width=device-width, height=device-height, initial-scale=1.0, maximum-scale=1.0, user-scalable=no\"/>\n");
            xhtml.append("  <title>Page ").append(pageNumber).append("</title>\n");
            xhtml.append("  <link rel=\"stylesheet\" type=\"text/css\" href=\"css/fixed-layout.css\"/>\n");
            xhtml.append("</head>\n");
        }
        
        // Extract body content
        String bodyContent = cleaned;
        if (cleaned.contains("<body")) {
            int bodyStart = cleaned.indexOf("<body");
            int bodyTagEnd = cleaned.indexOf(">", bodyStart) + 1;
            bodyContent = cleaned.substring(bodyTagEnd);
            if (bodyContent.contains("</body>")) {
                bodyContent = bodyContent.substring(0, bodyContent.indexOf("</body>"));
            }
        }
        
        // Ensure body has proper XHTML structure
        xhtml.append("<body class=\"fixed-layout-page\">\n");
        xhtml.append("  <div class=\"page-container\">\n");
        
        // Convert img tags to XHTML format (self-closing)
        bodyContent = bodyContent.replaceAll("<img([^>]*[^/])>", "<img$1/>");
        
        // Add body content
        xhtml.append(bodyContent);
        
        xhtml.append("  </div>\n");
        xhtml.append("</body>\n");
        xhtml.append("</html>\n");
        
        return xhtml.toString();
    }
}
