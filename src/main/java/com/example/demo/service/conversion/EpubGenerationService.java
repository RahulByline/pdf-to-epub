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

@Service
public class EpubGenerationService {

    private static final Logger logger = LoggerFactory.getLogger(EpubGenerationService.class);

    public String generateEpub(DocumentStructure structure, String outputDir, String fileName) throws IOException {
        return generateEpub(structure, outputDir, fileName, null);
    }

    public String generateEpub(DocumentStructure structure, String outputDir, String fileName, File pdfFile) throws IOException {
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
            
            // Generate mimetype file (must be first, uncompressed)
            createMimetypeFile(tempDir);
            
            // Generate container.xml
            createContainerFile(metaInfDir);
            
            // Render PDF pages as images for fixed-layout EPUB
            List<String> pageImageNames = new ArrayList<>();
            if (pdfFile != null && pdfFile.exists()) {
                pageImageNames = renderPdfPagesAsImages(pdfFile, oebpsDir, structure);
            }
            
            // Generate content.opf with fixed-layout metadata
            createContentOpf(oebpsDir, structure, fileName, pageImageNames);
            
            // Generate nav.xhtml (table of contents)
            createNavFile(oebpsDir, structure);
            
            // Generate fixed-layout content files
            List<String> contentFileNames = generateFixedLayoutContentFiles(oebpsDir, structure, pageImageNames);
            
            // Create CSS for fixed layout
            createFixedLayoutCSS(oebpsDir);
            
            // Copy images if any
            copyImages(oebpsDir, structure);
            
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
                
                // Save as PNG with consistent settings
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
                
                imageNames.add(imageName);
                
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
        
        // Add CSS for fixed layout
        if (!pageImageNames.isEmpty()) {
            opf.append("    <item id=\"css\" href=\"fixed-layout.css\" media-type=\"text/css\"/>\n");
        }
        
        // Add page images
        int imageId = 1;
        for (String imageName : pageImageNames) {
            opf.append("    <item id=\"page-img-").append(imageId).append("\" href=\"").append(imageName)
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
        
        // Add other images
        if (structure.getImages() != null) {
            for (ImageReference image : structure.getImages()) {
                String imageName = new File(image.getEpubPath() != null ? image.getEpubPath() : image.getOriginalPath()).getName();
                opf.append("    <item id=\"img-").append(image.getId()).append("\" href=\"").append(imageName)
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
        html.append("  <link rel=\"stylesheet\" type=\"text/css\" href=\"fixed-layout.css\"/>\n");
        html.append("</head>\n");
        html.append("<body class=\"fixed-layout-page\">\n");
        html.append("  <div class=\"page-container\">\n");
        
        // Page image - decorative, hidden from screen readers since text content is available
        if (imageName != null) {
            html.append("    <img src=\"").append(escapeHtml(imageName)).append("\" alt=\"\" class=\"page-image\" aria-hidden=\"true\"/>\n");
        }
        
        // Text content for accessibility - visible to screen readers but visually hidden
        // Sort blocks by reading order for proper TTS flow
        html.append("    <div class=\"text-content\" role=\"article\" aria-label=\"Page ").append(pageNumber).append(" content\">\n");
        if (page.getTextBlocks() != null && !page.getTextBlocks().isEmpty()) {
            // Sort by reading order to ensure correct TTS flow
            List<TextBlock> sortedBlocks = new ArrayList<>(page.getTextBlocks());
            sortedBlocks.sort((a, b) -> {
                Integer orderA = a.getReadingOrder();
                Integer orderB = b.getReadingOrder();
                if (orderA == null) orderA = Integer.MAX_VALUE;
                if (orderB == null) orderB = Integer.MAX_VALUE;
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
            "}\n";
        
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
        
        // Ensure block has a valid ID
        String blockId = block.getId();
        if (blockId == null || blockId.isEmpty()) {
            blockId = "block_" + System.currentTimeMillis() + "_" + (int)(Math.random() * 1000);
        }
        
        switch (block.getType()) {
            case HEADING:
                int level = block.getLevel() != null ? block.getLevel() : 2;
                // Ensure level is between 1-6
                level = Math.max(1, Math.min(6, level));
                html.append("<h").append(level).append(" id=\"").append(escapeHtml(blockId)).append("\">");
                html.append(escapeHtml(cleanedText));
                html.append("</h").append(level).append(">\n");
                break;
                
            case PARAGRAPH:
                html.append("<p id=\"").append(escapeHtml(blockId)).append("\">");
                html.append(escapeHtml(cleanedText));
                html.append("</p>\n");
                break;
                
            case LIST_ITEM:
            case LIST_UNORDERED:
                html.append("<ul id=\"").append(escapeHtml(blockId)).append("\">");
                html.append("<li>").append(escapeHtml(cleanedText)).append("</li>");
                html.append("</ul>\n");
                break;
                
            case LIST_ORDERED:
                html.append("<ol id=\"").append(escapeHtml(blockId)).append("\">");
                html.append("<li>").append(escapeHtml(cleanedText)).append("</li>");
                html.append("</ol>\n");
                break;
                
            case CAPTION:
                html.append("<p id=\"").append(escapeHtml(blockId)).append("\" class=\"caption\">");
                html.append(escapeHtml(cleanedText));
                html.append("</p>\n");
                break;
                
            default:
                html.append("<p id=\"").append(escapeHtml(blockId)).append("\">");
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
}
