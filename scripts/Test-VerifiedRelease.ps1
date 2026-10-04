param([Parameter(Mandatory=$true)][string]$Commit)
$ErrorActionPreference = 'Stop'
if ($Commit -notmatch '^[a-f0-9]{40}$') { exit 1 }
try {
    $uri = "https://api.github.com/repos/Saeed-rbh/MoniMonitor_Website/actions/workflows/verify.yml/runs?head_sha=$Commit&event=push&per_page=10"
    $result = Invoke-RestMethod -Uri $uri -Headers @{ Accept = 'application/vnd.github+json'; 'User-Agent' = 'MoniMonitor-release-gate' } -TimeoutSec 15
    $run = $result.workflow_runs | Where-Object { $_.head_sha -eq $Commit -and $_.head_branch -eq 'main' -and $_.event -eq 'push' } | Sort-Object run_number -Descending | Select-Object -First 1
    if ($run.status -eq 'completed' -and $run.conclusion -eq 'success') { exit 0 }
} catch { Write-Warning 'Release verification unavailable; keeping the existing running version.' }
exit 1
