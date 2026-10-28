# Stops virtual_modems runners started by start_lab.ps1 (uses the runner's per-port lock files).
# Usage: powershell -ExecutionPolicy Bypass -File virtual_modems\stop_lab.ps1 [-Port 80]   (no -Port stops every runner)
param(
    [int]$Port = 0
)

$ErrorActionPreference = "Stop"
$stateDir = Join-Path $env:TEMP "virtual_modems"
$pattern = if ($Port -gt 0) { "active_modem_$Port.json" } else { "active_modem_*.json" }
$stateFiles = @(Get-ChildItem -Path $stateDir -Filter $pattern -File -ErrorAction SilentlyContinue)
if ($stateFiles.Count -eq 0) {
    Write-Host "no running virtual_modems profile (lock file missing)"
    exit 0
}
foreach ($stateFile in $stateFiles) {
    $state = Get-Content $stateFile.FullName -Raw | ConvertFrom-Json
    $process = Get-Process -Id $state.pid -ErrorAction SilentlyContinue
    if ($process) {
        Stop-Process -Id $state.pid -Force
        Write-Host "stopped profile=$($state.profile) pid=$($state.pid) port=$($state.port)"
    } else {
        Write-Host "process $($state.pid) not running; removing stale lock $($stateFile.Name)"
    }
    Remove-Item $stateFile.FullName -Force -ErrorAction SilentlyContinue
}
