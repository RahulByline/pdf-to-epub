# PowerShell script to create .env file for local development
# Run this script from the backend directory: .\create-env-local.ps1

# First, backup existing .env if it exists
if (Test-Path ".env") {
    Write-Host "📦 Backing up existing .env to .env.production..." -ForegroundColor Cyan
    Copy-Item ".env" ".env.production" -Force
    Write-Host "✅ Backup created: .env.production" -ForegroundColor Green
}

$envContent = @"
# Environment
NODE_ENV=development

# Server Configuration
PORT=5000

# Database Local Development
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=epub_db

# JWT Secret
JWT_SECRET=local-development-jwt-secret-key

# API Keys
GOOGLE_API_KEY=your-google-api-key-here
GEMINI_API_KEY=your-gemini-api-key-here

# CORS Settings
CORS_ORIGIN=http://localhost:3000

# File Upload Settings
MAX_FILE_SIZE=52428800
UPLOAD_DIR=./uploads
TEMP_DIR=./temp
"@

# Create the .env file
$envContent | Out-File -FilePath ".env" -Encoding UTF8 -NoNewline

Write-Host "✅ .env file created for LOCAL DEVELOPMENT!" -ForegroundColor Green
Write-Host ""
Write-Host "📝 Next steps:" -ForegroundColor Cyan
Write-Host "   1. Update DB_PASSWORD if your local MySQL has a password" -ForegroundColor White
Write-Host "   2. Create local database: CREATE DATABASE epub_db;" -ForegroundColor White
Write-Host "   3. Run schema: mysql -u root -p epub_db < database/schema.sql" -ForegroundColor White
Write-Host "   4. Add your API keys if needed" -ForegroundColor White
Write-Host ""
Write-Host "🔄 To switch back to production: .\switch-to-production.ps1" -ForegroundColor Yellow
Write-Host "🚀 To start the server: npm run dev" -ForegroundColor Cyan
