# Backend Server Startup Script
# This script starts the server and shows any errors

Write-Host "Starting PDF to EPUB Backend Server..." -ForegroundColor Cyan
Write-Host ""

# Check if .env exists
if (-not (Test-Path ".env")) {
    Write-Host "WARNING: .env file not found!" -ForegroundColor Yellow
    Write-Host "The server may fail to connect to the database." -ForegroundColor Yellow
    Write-Host "Create a .env file with database credentials." -ForegroundColor Yellow
    Write-Host ""
}

# Start the server
Write-Host "Starting server on port 8081..." -ForegroundColor Green
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Gray
Write-Host ""

node server.js


