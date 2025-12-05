# PowerShell script to stop any process using port 8081
param(
    [int]$Port = 8081
)

Write-Host "Checking for processes on port $Port..." -ForegroundColor Yellow

$connections = netstat -ano | Select-String ":$Port.*LISTENING"

if ($connections) {
    $processIds = $connections | ForEach-Object {
        ($_ -split '\s+')[-1]
    } | Select-Object -Unique

    foreach ($processId in $processIds) {
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($process) {
            Write-Host "Found process: $($process.ProcessName) (PID: $processId)" -ForegroundColor Cyan
            Stop-Process -Id $processId -Force
            Write-Host "Stopped process $processId" -ForegroundColor Green
        }
    }
    Write-Host ""
    Write-Host "Port $Port is now free!" -ForegroundColor Green
} else {
    Write-Host "No process found on port $Port" -ForegroundColor Green
}
