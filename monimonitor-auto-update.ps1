$ErrorActionPreference = 'Stop'

$repository = $PSScriptRoot
$pidFile = Join-Path $env:TEMP 'monimonitor-api.pid'
$stateDirectory = Join-Path $env:LOCALAPPDATA 'MoniMonitor'
$logFile = Join-Path $stateDirectory 'auto-update.log'
$runningCommitFile = Join-Path $stateDirectory 'running-commit.txt'
$lastUpdateFile = Join-Path $stateDirectory 'last-update.json'
$localHealthUrl = 'http://127.0.0.1:3001/health'
$publicHealthUrl = 'https://monimonitor.saeedarabha.com/api/health'
$tailscaleExecutable = 'C:\Program Files\Tailscale\tailscale.exe'
$mutex = [System.Threading.Mutex]::new($false, 'Local\MoniMonitorGitAutoUpdater')
$hasMutex = $false

function Write-UpdateLog {
    param([string]$Message)

    try {
        if (-not (Test-Path -LiteralPath $stateDirectory)) {
            New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
        }

        $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
        Add-Content -LiteralPath $logFile -Value "[$timestamp] $Message"
    }
    catch {
        # Logging must never stop the update watcher.
    }
}

function Stop-MoniMonitorBackend {
    $candidateIds = [System.Collections.Generic.HashSet[int]]::new()

    if (Test-Path -LiteralPath $pidFile) {
        $savedPid = 0
        if ([int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(), [ref]$savedPid)) {
            [void]$candidateIds.Add($savedPid)
        }
    }

    Get-CimInstance Win32_Process -Filter "Name = 'cmd.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'MoniMonitor API \+ Email \+ Telegram' } |
        ForEach-Object { [void]$candidateIds.Add([int]$_.ProcessId) }

    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like '*MoniMonitor_Website*concurrently*' } |
        ForEach-Object { [void]$candidateIds.Add([int]$_.ProcessId) }

    foreach ($candidateId in $candidateIds) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $candidateId" -ErrorAction SilentlyContinue
        $isLauncher = $process -and $process.Name -eq 'cmd.exe' -and $process.CommandLine -match 'npm run dev'
        $isSupervisor = $process -and $process.Name -eq 'node.exe' -and
            $process.CommandLine -like '*MoniMonitor_Website*concurrently*'
        if ($isLauncher -or $isSupervisor) {
            & taskkill.exe /PID $candidateId /T /F | Out-Null
        }
    }

    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

function Write-UpdateReceipt {
    param([string]$FromCommit, [string]$ToCommit)

    try {
        if (-not (Test-Path -LiteralPath $stateDirectory)) {
            New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
        }

        @{
            fromCommit = $FromCommit
            toCommit = $ToCommit
            receivedAt = (Get-Date).ToString('o')
        } | ConvertTo-Json | Set-Content -LiteralPath $lastUpdateFile -Encoding UTF8
    }
    catch {
        Write-UpdateLog "Could not save the visible update receipt: $($_.Exception.Message)"
    }
}

function Test-CleanMainBranch {
    $branch = (& git -C $repository branch --show-current 2>$null).Trim()
    if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') {
        return $false
    }

    $changes = & git -C $repository status --porcelain 2>$null
    return $LASTEXITCODE -eq 0 -and -not $changes
}

function Test-MoniMonitorHealth {
    param([string]$Url, [int]$TimeoutSec = 8)

    try {
        $health = Invoke-RestMethod -Uri $Url -TimeoutSec $TimeoutSec
        return $health.status -eq 'ok'
    }
    catch {
        return $false
    }
}

function Repair-PublicTunnel {
    if (-not (Test-MoniMonitorHealth -Url $localHealthUrl)) {
        Write-UpdateLog 'Public API is unavailable and the local API is not healthy; Funnel repair was skipped.'
        return
    }

    if (-not (Test-Path -LiteralPath $tailscaleExecutable)) {
        Write-UpdateLog 'Public API is unavailable and Tailscale was not found at the configured path.'
        return
    }

    Write-UpdateLog 'Public API health check failed; resetting and repairing Tailscale Funnel.'
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        if ($attempt -gt 1) {
            & $tailscaleExecutable serve reset 2>$null | Out-Null
            Start-Sleep -Seconds 2
        }
        & $tailscaleExecutable funnel --bg 3001 2>$null | Out-Null
        Start-Sleep -Seconds 5
        if (Test-MoniMonitorHealth -Url $publicHealthUrl) {
            Write-UpdateLog "Public API connectivity restored on attempt $attempt."
            return
        }
    }

    Write-UpdateLog 'Tailscale Funnel repair did not restore the public API after three attempts.'
}

try {
    try {
        $hasMutex = $mutex.WaitOne(0, $false)
    }
    catch [System.Threading.AbandonedMutexException] {
        $hasMutex = $true
    }

    if (-not $hasMutex) {
        exit 0
    }

    Write-UpdateLog 'Automatic update watcher started; checking every 60 seconds.'
    $env:GIT_TERMINAL_PROMPT = '0'

    while ($true) {
        Start-Sleep -Seconds 60

        try {
            if (-not (Test-MoniMonitorHealth -Url $publicHealthUrl)) {
                Repair-PublicTunnel
            }

            if (-not (Test-CleanMainBranch)) {
                continue
            }

            & git -C $repository fetch --quiet origin main
            if ($LASTEXITCODE -ne 0) {
                Write-UpdateLog 'GitHub fetch failed; the running version was left unchanged.'
                continue
            }

            $localCommit = (& git -C $repository rev-parse HEAD 2>$null).Trim()
            $remoteCommit = (& git -C $repository rev-parse origin/main 2>$null).Trim()
            if (-not $localCommit -or -not $remoteCommit) {
                continue
            }

            if ($localCommit -ne $remoteCommit) {
                & git -C $repository merge-base --is-ancestor $localCommit $remoteCommit
                if ($LASTEXITCODE -ne 0) {
                    Write-UpdateLog 'GitHub changed, but the update was not a safe fast-forward. Update skipped.'
                    continue
                }

                & git -C $repository merge --ff-only origin/main
                if ($LASTEXITCODE -ne 0) {
                    Write-UpdateLog 'Fast-forward merge failed. The running version was left unchanged.'
                    continue
                }

                Write-UpdateReceipt -FromCommit $localCommit -ToCommit $remoteCommit
                Write-UpdateLog "Updated repository from $localCommit to $remoteCommit."
                $localCommit = (& git -C $repository rev-parse HEAD 2>$null).Trim()
            }

            $runningCommit = if (Test-Path -LiteralPath $runningCommitFile) {
                (Get-Content -LiteralPath $runningCommitFile -Raw).Trim()
            } else {
                ''
            }
            if ($runningCommit -eq $localCommit) {
                continue
            }

            if ($runningCommit) {
                Write-UpdateLog "Running commit $runningCommit differs from repository commit $localCommit; restarting MoniMonitor."
            } else {
                Write-UpdateLog "Running commit is unknown; restarting MoniMonitor at $localCommit."
            }
            Stop-MoniMonitorBackend

            # Release ownership before relaunching so the updated watcher can take over.
            $mutex.ReleaseMutex()
            $hasMutex = $false
            Start-Process -FilePath (Join-Path $repository 'start-monimonitor.cmd') -ArgumentList '--auto-update-restart' -WorkingDirectory $repository
            Start-Sleep -Seconds 10
            exit 0
        }
        catch {
            Write-UpdateLog "Update check failed: $($_.Exception.Message)"
        }
    }
}
finally {
    if ($hasMutex) {
        $mutex.ReleaseMutex()
    }
    $mutex.Dispose()
}
