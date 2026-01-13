# PowerShell script to create .env file for production
# Run this script from the backend directory: .\create-env.ps1

$envContent = @"
# Environment
NODE_ENV=production

# Server Configuration
PORT=5000

# Database Production
DB_HOST=localhost
DB_PORT=3306
DB_USER=bylinelm_epub
DB_PASSWORD=admin@Byline25
DB_NAME=bylinelm_epub

# JWT Secret (CHANGE THIS to a random secure string!)
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# API Keys (Add your actual API keys here)
GOOGLE_API_KEY=your-google-api-key-here
GEMINI_API_KEY=your-gemini-api-key-here

# CORS Settings (Update with your frontend URL)
CORS_ORIGIN=http://localhost:3000

# File Upload Settings
MAX_FILE_SIZE=52428800
UPLOAD_DIR=./uploads
TEMP_DIR=./temp
"@

# Create the .env file
$envContent | Out-File -FilePath ".env" -Encoding UTF8 -NoNewline

Write-Host "✅ .env file created successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "⚠️  IMPORTANT: Please update the following in your .env file:" -ForegroundColor Yellow
Write-Host "   1. JWT_SECRET - Change to a secure random string" -ForegroundColor Yellow
Write-Host "   2. GOOGLE_API_KEY - Add your Google Cloud API key" -ForegroundColor Yellow
Write-Host "   3. GEMINI_API_KEY - Add your Gemini AI API key" -ForegroundColor Yellow
Write-Host "   4. CORS_ORIGIN - Update with your frontend domain" -ForegroundColor Yellow
Write-Host ""
Write-Host "📝 For local development, run: .\create-env-local.ps1" -ForegroundColor Cyan
Write-Host ""
Write-Host "🚀 To start the server: npm start" -ForegroundColor Cyan
