$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$entry = Join-Path $repository 'server\index.js'
$nodes = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'")
$children = @($nodes | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($entry) })
if ($children.Count) {
    Set-Content -LiteralPath (Join-Path $env:TEMP 'monimonitor-3001.stop') -Value 'drain'
    $deadline = (Get-Date).AddSeconds(40)
    do {
        Start-Sleep -Milliseconds 500
        $remaining = @($children | Where-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue })
    } while ($remaining.Count -and (Get-Date) -lt $deadline)
}
foreach ($child in $children) {
    $fresh = Get-CimInstance Win32_Process -Filter "ProcessId = $($child.ProcessId)" -ErrorAction SilentlyContinue
    if (-not $fresh -or -not $fresh.CommandLine.Contains($entry)) { continue }
    $parent = $nodes | Where-Object { $_.ProcessId -eq $child.ParentProcessId -and $_.CommandLine -match 'scripts[/\\]supervise\.js' }
    if ($parent) { Stop-Process -Id $parent.ProcessId -Force -ErrorAction SilentlyContinue }
    Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 1
if (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue) { exit 1 }
exit 0
