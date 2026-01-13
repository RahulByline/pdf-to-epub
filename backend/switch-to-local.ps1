# PowerShell script to switch to local development environment
# Run this script from the backend directory: .\switch-to-local.ps1

if (-not (Test-Path ".env.local")) {
    Write-Host "❌ Error: .env.local file not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please run .\create-env-local.ps1 first to create local configuration." -ForegroundColor Yellow
    exit 1
}

# Backup current .env as .env.production if it exists
if (Test-Path ".env") {
    Write-Host "📦 Backing up current .env to .env.production..." -ForegroundColor Cyan
    Copy-Item ".env" ".env.production" -Force
    Write-Host "✅ Backup created: .env.production" -ForegroundColor Green
}

# Copy local config to .env
Copy-Item ".env.local" ".env" -Force

Write-Host ""
Write-Host "✅ Switched to LOCAL DEVELOPMENT environment!" -ForegroundColor Green
Write-Host ""
Write-Host "Current configuration:" -ForegroundColor Cyan
Write-Host "   Database: epub_db" -ForegroundColor White
Write-Host "   User: root" -ForegroundColor White
Write-Host "   Environment: development" -ForegroundColor White
Write-Host ""
Write-Host "📝 Make sure your local database is set up:" -ForegroundColor Yellow
Write-Host "   1. Create database: CREATE DATABASE epub_db;" -ForegroundColor Yellow
Write-Host "   2. Load schema: mysql -u root -p epub_db < database\schema.sql" -ForegroundColor Yellow
Write-Host ""
Write-Host "🔄 To switch back to production: .\switch-to-production.ps1" -ForegroundColor Cyan
Write-Host "🚀 To start the server: npm run dev" -ForegroundColor Cyan
