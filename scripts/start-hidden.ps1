param(
  [Parameter(Mandatory=$true)][string]$ScriptPath
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $ScriptPath)) {
  throw "Script not found: $ScriptPath"
}
Start-Process -FilePath $env:ComSpec -ArgumentList @('/c', "`"$ScriptPath`"") -WindowStyle Hidden -WorkingDirectory (Split-Path -Parent $ScriptPath)
