# Tesseract OCR Installation Guide

Tesseract OCR is required for processing scanned PDFs. This guide provides installation instructions for different operating systems.

## Windows Installation

### Method 1: Using Installer (Recommended)

1. **Download Tesseract Installer**
   - Visit: https://github.com/UB-Mannheim/tesseract/wiki
   - Download the latest Windows installer (e.g., `tesseract-ocr-w64-setup-5.x.x.exe`)

2. **Run the Installer**
   - Run the downloaded `.exe` file
   - **Important**: During installation, note the installation path (usually `C:\Program Files\Tesseract-OCR`)
   - Make sure to check "Add to PATH" option if available
   - Complete the installation

3. **Verify Installation**
   ```cmd
   tesseract --version
   ```

4. **Default Installation Paths**
   - `C:\Program Files\Tesseract-OCR\tessdata` (tessdata folder)
   - `C:\Program Files (x86)\Tesseract-OCR\tessdata` (32-bit)

### Method 2: Using Chocolatey

```powershell
choco install tesseract
```

### Method 3: Using Scoop

```powershell
scoop install tesseract
```

## Linux Installation

### Ubuntu/Debian

```bash
# Update package list
sudo apt update

# Install Tesseract OCR
sudo apt install tesseract-ocr

# Install additional language packs (optional)
sudo apt install tesseract-ocr-eng  # English (usually included)
sudo apt install tesseract-ocr-fra  # French
sudo apt install tesseract-ocr-deu  # German
sudo apt install tesseract-ocr-spa  # Spanish
# ... and more as needed

# Verify installation
tesseract --version
```

### Fedora/RHEL/CentOS

```bash
# Install Tesseract OCR
sudo dnf install tesseract
# or for older versions:
# sudo yum install tesseract

# Install language packs
sudo dnf install tesseract-langpack-eng
```

### Arch Linux

```bash
sudo pacman -S tesseract
sudo pacman -S tesseract-data-eng  # English language data
```

## macOS Installation

### Method 1: Using Homebrew (Recommended)

```bash
# Install Homebrew if not already installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Tesseract OCR
brew install tesseract

# Install language packs (optional)
brew install tesseract-lang  # Installs all language packs
# Or install specific languages:
# brew install tesseract-lang-eng
# brew install tesseract-lang-fra

# Verify installation
tesseract --version
```

### Method 2: Using MacPorts

```bash
sudo port install tesseract
```

## Verify Installation

After installation, verify Tesseract is working:

```bash
# Check version
tesseract --version

# List available languages
tesseract --list-langs

# Test OCR (if you have an image file)
tesseract image.png output.txt
```

## Configuration in Application

### Option 1: Automatic Detection (Current Implementation)

The current `OcrService` will try to auto-detect Tesseract. If Tesseract is in your system PATH, it should work automatically.

### Option 2: Manual Configuration

If Tesseract is installed in a non-standard location, configure it in `application.properties`:

```properties
# Tesseract OCR Configuration
# Windows example:
# tesseract.datapath=C:/Program Files/Tesseract-OCR/tessdata

# Linux example:
# tesseract.datapath=/usr/share/tesseract-ocr/5/tessdata

# macOS example:
# tesseract.datapath=/usr/local/share/tesseract-ocr/tessdata
```

### Option 3: Update OcrService for Better Auto-Detection

If you want to improve auto-detection, you can update the `OcrService` constructor to check more paths. Here's an enhanced version:

```java
@PostConstruct
private void initializeTesseract() {
    try {
        tesseract = new Tesseract();
        
        // Try to find tessdata directory
        String[] possiblePaths = {
            System.getenv("TESSDATA_PREFIX"),  // Environment variable
            "C:/Program Files/Tesseract-OCR/tessdata",  // Windows default
            "C:/Program Files (x86)/Tesseract-OCR/tessdata",  // Windows 32-bit
            "/usr/share/tesseract-ocr/5/tessdata",  // Linux Tesseract 5
            "/usr/share/tesseract-ocr/4.00/tessdata",  // Linux Tesseract 4
            "/usr/local/share/tesseract-ocr/tessdata",  // macOS Homebrew
            "/opt/homebrew/share/tesseract-ocr/tessdata",  // macOS Homebrew (Apple Silicon)
            "./tessdata"  // Local project directory
        };
        
        for (String path : possiblePaths) {
            if (path != null) {
                File dataDir = new File(path);
                if (dataDir.exists() && dataDir.isDirectory()) {
                    tesseract.setDatapath(path);
                    logger.info("Tesseract data path set to: " + path);
                    break;
                }
            }
        }
        
        tesseract.setLanguage("eng");
        logger.info("Tesseract OCR initialized successfully");
        
    } catch (Exception e) {
        logger.warn("Tesseract OCR initialization failed. OCR functionality will be limited.", e);
        tesseract = null;
    }
}
```

## Language Packs

Tesseract supports many languages. Common language codes:

- `eng` - English
- `fra` - French
- `deu` - German
- `spa` - Spanish
- `ita` - Italian
- `por` - Portuguese
- `chi_sim` - Chinese (Simplified)
- `chi_tra` - Chinese (Traditional)
- `jpn` - Japanese
- `kor` - Korean
- `ara` - Arabic
- `hin` - Hindi
- `rus` - Russian

To use multiple languages:

```java
tesseract.setLanguage("eng+fra");  // English and French
```

## Troubleshooting

### Issue: "Tesseract not initialized" error

**Solutions:**
1. Verify Tesseract is installed: `tesseract --version`
2. Check if tessdata directory exists
3. Set `tesseract.datapath` in `application.properties`
4. Ensure Tesseract is in system PATH

### Issue: "Language not found" error

**Solutions:**
1. Install the required language pack
2. Verify language code is correct (use `tesseract --list-langs`)
3. Check tessdata directory contains the language file (e.g., `eng.traineddata`)

### Issue: Low OCR accuracy

**Solutions:**
1. Use higher DPI when rendering PDF pages (currently 300 DPI)
2. Pre-process images (deskew, denoise, enhance contrast)
3. Use appropriate language pack
4. For better accuracy, consider cloud OCR services (Google Vision, AWS Textract)

### Issue: Out of Memory errors

**Solutions:**
1. Process pages one at a time (already implemented)
2. Reduce DPI if memory is limited
3. Increase JVM heap size: `-Xmx2g`

## Testing OCR Functionality

After installation, test OCR with a sample PDF:

1. Upload a scanned PDF through the API
2. Start a conversion job
3. Check logs for OCR processing
4. Review the extracted text in intermediate data

## Alternative: Cloud OCR Services

For production environments, consider using cloud OCR services for better accuracy:

- **Google Cloud Vision API**
- **AWS Textract**
- **Azure Computer Vision**
- **ABBYY FineReader**

These services typically provide:
- Higher accuracy
- Better handling of complex layouts
- Multi-language support
- No local installation required

## Next Steps

1. Install Tesseract OCR using the instructions above
2. Verify installation with `tesseract --version`
3. Restart your Spring Boot application
4. Test with a scanned PDF upload
5. Monitor logs for OCR processing

