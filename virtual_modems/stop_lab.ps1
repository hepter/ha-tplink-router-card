# Stops the virtual lab started by start_lab.ps1 (uses the runner's lock file).
$ErrorActionPreference = "Stop"
$stateFile = Join-Path $env:TEMP "virtual_modems\active_modem.json"
if (-not (Test-Path $stateFile)) {
    Write-Host "no running virtual_modems profile (lock file missing)"
    exit 0
}
$state = Get-Content $stateFile -Raw | ConvertFrom-Json
$process = Get-Process -Id $state.pid -ErrorAction SilentlyContinue
if ($process) {
    Stop-Process -Id $state.pid -Force
    Write-Host "stopped profile=$($state.profile) pid=$($state.pid)"
} else {
    Write-Host "process $($state.pid) not running; removing stale lock"
}
Remove-Item $stateFile -Force -ErrorAction SilentlyContinue
