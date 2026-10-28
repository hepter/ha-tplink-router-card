# Starts a virtual_modems profile in the background (Windows); one runner per port.
# Usage: powershell -ExecutionPolicy Bypass -File virtual_modems\start_lab.ps1 [-Profile lab] [-Port 80]
param(
    [string]$Profile = "lab",
    [int]$Port = 80
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $repoRoot "virtual_modems\.venv\Scripts\python.exe"
$python = if (Test-Path $venvPython) { $venvPython } else { "python" }
$logDir = Join-Path $env:TEMP "virtual_modems"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "$Profile-$Port.log"

$stateFile = Join-Path $logDir "active_modem_$Port.json"
if (Test-Path $stateFile) {
    $state = Get-Content $stateFile -Raw | ConvertFrom-Json
    if ($state.pid -and (Get-Process -Id $state.pid -ErrorAction SilentlyContinue)) {
        Write-Host "port $Port already used by virtual_modems profile=$($state.profile) pid=$($state.pid)"
        exit 0
    }
}

$process = Start-Process -FilePath $python `
    -ArgumentList @("-m", "virtual_modems.run", $Profile, "--port", "$Port") `
    -WorkingDirectory $repoRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $logFile `
    -RedirectStandardError (Join-Path $logDir "$Profile-$Port.err.log") `
    -PassThru

Write-Host "started virtual_modems profile=$Profile pid=$($process.Id) port=$Port log=$logFile"
