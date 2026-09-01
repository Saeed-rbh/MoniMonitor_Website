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
    Write-SchedulerLog 'Starting the MoniMonitor launcher.'
    $process = Start-Process `
        -FilePath $env:ComSpec `
        -ArgumentList '/d', '/c', "`"$launcher`" --auto-update-restart" `
        -WorkingDirectory $repository `
        -Wait `
        -PassThru `
        -WindowStyle Hidden

    Write-SchedulerLog "Launcher exited with code $($process.ExitCode)."
    if ($process.ExitCode -ne 0) {
        throw "The MoniMonitor launcher failed with exit code $($process.ExitCode)."
    }
}

try {
    Write-SchedulerLog 'Scheduled supervisor started.'
    Start-MoniMonitorLauncher

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
    Write-SchedulerLog "Scheduled supervisor failed: $($_.Exception.Message)"
    exit 1
}

