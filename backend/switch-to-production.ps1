# PowerShell script to switch to production environment
# Run this script from the backend directory: .\switch-to-production.ps1

if (-not (Test-Path ".env.production")) {
    Write-Host "❌ Error: .env.production file not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please run .\create-env.ps1 first to create production configuration." -ForegroundColor Yellow
    exit 1
}

# Backup current .env as .env.local if it exists
if (Test-Path ".env") {
    Write-Host "📦 Backing up current .env to .env.local..." -ForegroundColor Cyan
    Copy-Item ".env" ".env.local" -Force
    Write-Host "✅ Backup created: .env.local" -ForegroundColor Green
}

# Copy production config to .env
Copy-Item ".env.production" ".env" -Force

Write-Host ""
Write-Host "✅ Switched to PRODUCTION environment!" -ForegroundColor Green
Write-Host ""
Write-Host "Current configuration:" -ForegroundColor Cyan
Write-Host "   Database: bylinelm_epub" -ForegroundColor White
Write-Host "   User: bylinelm_epub" -ForegroundColor White
Write-Host "   Environment: production" -ForegroundColor White
Write-Host ""
Write-Host "⚠️  Make sure your production database is set up:" -ForegroundColor Yellow
Write-Host "   - Schema is loaded (database/schema.sql)" -ForegroundColor Yellow
Write-Host "   - API keys are configured" -ForegroundColor Yellow
Write-Host "   - CORS_ORIGIN is set to your frontend domain" -ForegroundColor Yellow
Write-Host ""
Write-Host "🔄 To switch back to local: .\switch-to-local.ps1" -ForegroundColor Cyan
Write-Host "🚀 To start the server: npm start" -ForegroundColor Cyan
