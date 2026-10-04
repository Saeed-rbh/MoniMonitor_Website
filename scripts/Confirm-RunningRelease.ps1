param([switch]$Record)
$ErrorActionPreference = 'Stop'
try {
    $repository = Split-Path -Parent $PSScriptRoot
    $current = (& git -C $repository rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { exit 1 }
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/diagnostics' -TimeoutSec 10
    if ($health.app.commit -ne $current -or -not $health.agent.enabled -or $health.agent.state -ne 'ready') { exit 1 }
    if ($Record) {
        $state = Join-Path $env:LOCALAPPDATA 'MoniMonitor'
        [void](New-Item -ItemType Directory -Path $state -Force)
        Set-Content -LiteralPath (Join-Path $state 'running-commit.txt') -Value $health.app.commit
    }
    exit 0
} catch { exit 1 }
