param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Ports
)

$ErrorActionPreference = 'Continue'

function Add-PortValue {
  param([string]$Value, [System.Collections.Generic.List[int]]$Target)
  if ([string]::IsNullOrWhiteSpace($Value)) { return }
  foreach ($part in ($Value -split '[,;\s]+')) {
    if ([string]::IsNullOrWhiteSpace($part)) { continue }
    $n = 0
    if ([int]::TryParse($part, [ref]$n)) {
      if ($n -gt 0 -and -not $Target.Contains($n)) { [void]$Target.Add($n) }
    } else {
      Write-Output "Skipping invalid port token: $part"
    }
  }
}

$portList = [System.Collections.Generic.List[int]]::new()
if ($Ports -and $Ports.Count -gt 0) {
  foreach ($entry in $Ports) { Add-PortValue -Value $entry -Target $portList }
}
if ($portList.Count -eq 0) {
  foreach ($p in @(8890,5290,8891,5291,8892,5292)) { [void]$portList.Add([int]$p) }
}

foreach ($port in $portList) {
  try {
    Write-Output "Checking port $port"
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $connections) {
      Write-Output "No listener on port $port"
      continue
    }
    foreach ($conn in $connections) {
      $pidValue = $conn.OwningProcess
      if ($pidValue) {
        $proc = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
        $procName = if ($proc) { $proc.ProcessName } else { 'unknown' }
        Write-Output "Stopping process on port $port, PID $pidValue, process $procName"
        Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 250
      }
    }
  } catch {
    Write-Output "Port cleanup skipped for ${port}: $($_.Exception.Message)"
  }
}
