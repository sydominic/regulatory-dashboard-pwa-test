param(
  [Parameter(Mandatory=$true)][string]$Url
)
try {
  $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
  if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
    Write-Output "OK $Url $($response.StatusCode)"
    exit 0
  }
  Write-Output "NOT_READY $Url $($response.StatusCode)"
  exit 1
} catch {
  Write-Output "NOT_READY $Url $($_.Exception.Message)"
  exit 1
}
