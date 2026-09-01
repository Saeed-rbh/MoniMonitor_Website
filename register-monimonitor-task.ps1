#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'

$taskName = 'MoniMonitor'
$repository = $PSScriptRoot
$supervisor = Join-Path $repository 'run-monimonitor-scheduled.ps1'
$powershellExecutable = Join-Path $PSHOME 'powershell.exe'
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name

if (-not (Test-Path -LiteralPath $supervisor)) {
    throw "Scheduled supervisor was not found: $supervisor"
}

$action = New-ScheduledTaskAction `
    -Execute $powershellExecutable `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$supervisor`"" `
    -WorkingDirectory $repository

$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT30S'

$principal = New-ScheduledTaskPrincipal `
    -UserId $currentUser `
    -LogonType S4U `
    -RunLevel Highest

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew

$task = New-ScheduledTask `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description 'Starts and supervises the MoniMonitor backend, integrations, and public tunnel.'

Register-ScheduledTask -TaskName $taskName -InputObject $task -Force | Out-Null

$registered = Get-ScheduledTask -TaskName $taskName
$info = Get-ScheduledTaskInfo -TaskName $taskName

[pscustomobject]@{
    TaskName = $registered.TaskName
    State = $registered.State
    User = $registered.Principal.UserId
    LogonType = $registered.Principal.LogonType
    RunLevel = $registered.Principal.RunLevel
    Execute = $registered.Actions.Execute
    Arguments = $registered.Actions.Arguments
    WorkingDirectory = $registered.Actions.WorkingDirectory
    RestartCount = $registered.Settings.RestartCount
    RestartInterval = $registered.Settings.RestartInterval
    LastTaskResult = $info.LastTaskResult
} | Format-List
