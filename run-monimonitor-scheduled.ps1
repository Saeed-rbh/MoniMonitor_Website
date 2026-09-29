$ErrorActionPreference = 'Stop'

$repository = $PSScriptRoot
$launcher = Join-Path $repository 'start-monimonitor.cmd'
$stateDirectory = Join-Path $env:LOCALAPPDATA 'MoniMonitor'
$logFile = Join-Path $stateDirectory 'scheduled-task.log'
$healthUrl = 'http://127.0.0.1:3001/health'

function Write-SchedulerLog {
    param([Parameter(Mandatory)][string]$Message)

    New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -LiteralPath $logFile -Value "[$timestamp] $Message"
}

function Test-MoniMonitorReady {
    try {
        $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 5
        return $health.status -eq 'ok' -and
            $health.agent.enabled -eq $true -and
            $health.agent.state -eq 'ready'
    }
    catch {
        return $false
    }
}

function Start-MoniMonitorLauncher {
    param([int]$TimeoutSeconds = 180)
    Write-SchedulerLog 'Starting the MoniMonitor launcher.'
    $process = Start-Process `
        -FilePath $env:ComSpec `
        -ArgumentList '/d', '/c', "`"$launcher`" --auto-update-restart --no-pause" `
        -WorkingDirectory $repository `
        -PassThru `
        -WindowStyle Hidden

    $completed = $process.WaitForExit($TimeoutSeconds * 1000)
    if (-not $completed) {
        Write-SchedulerLog "Launcher timed out after $TimeoutSeconds seconds. Terminating launcher process tree."
        try {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        } catch {}
        throw "The MoniMonitor launcher timed out after $TimeoutSeconds seconds."
    }

    Write-SchedulerLog "Launcher exited with code $($process.ExitCode)."
    if ($process.ExitCode -ne 0) {
        throw "The MoniMonitor launcher failed with exit code $($process.ExitCode)."
    }
}

Write-SchedulerLog 'Scheduled supervisor started.'

$retryCooldownSeconds = 0
while ($true) {
    try {
        if ($retryCooldownSeconds -gt 0) {
            Write-SchedulerLog "Retrying launcher after $retryCooldownSeconds-second cooldown."
            Start-Sleep -Seconds $retryCooldownSeconds
        }

        Start-MoniMonitorLauncher

        # Launcher succeeded — reset backoff and enter the health-check loop.
        $retryCooldownSeconds = 0
        $consecutiveFailures = 0

        while ($true) {
            Start-Sleep -Seconds 30

            if (Test-MoniMonitorReady) {
                $consecutiveFailures = 0
                continue
            }

            $consecutiveFailures++
            if ($consecutiveFailures -lt 2) {
                continue
            }

            Write-SchedulerLog 'Backend readiness failed twice; relaunching MoniMonitor.'
            Start-MoniMonitorLauncher
            $consecutiveFailures = 0
        }
    }
    catch {
        Write-SchedulerLog "Supervisor encountered an error: $($_.Exception.Message)"

        # Exponential backoff: 30s → 60s → 120s → ... capped at 600s (10 min).
        if ($retryCooldownSeconds -eq 0) {
            $retryCooldownSeconds = 30
        } else {
            $retryCooldownSeconds = [Math]::Min($retryCooldownSeconds * 2, 600)
        }

        Write-SchedulerLog "Will retry in $retryCooldownSeconds seconds."
    }
}

