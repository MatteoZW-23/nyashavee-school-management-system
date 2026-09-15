# Verify a backup before it is copied off-site or used for a restore.
# This does not touch the live database or uploads volume.
param(
  [Parameter(Mandatory = $true)][string]$Timestamp,
  [string]$OutDir = "data/backups"
)

$ErrorActionPreference = "Stop"
$manifest = Join-Path $OutDir "manifest-$Timestamp.sha256"
$sql = Join-Path $OutDir "nyashavee-$Timestamp.sql"
$uploads = Join-Path $OutDir "uploads-$Timestamp.tar.gz"
foreach ($file in @($manifest, $sql, $uploads)) {
  if (-not (Test-Path -LiteralPath $file)) { throw "Required backup file is missing: $file" }
}

$expected = @{}
Get-Content -LiteralPath $manifest | ForEach-Object {
  if ($_ -match '^([A-Fa-f0-9]{64})\s{2}(.+)$') { $expected[$Matches[2]] = $Matches[1].ToUpperInvariant() }
}
foreach ($file in @($sql, $uploads)) {
  $name = Split-Path $file -Leaf
  $actual = (Get-FileHash -Algorithm SHA256 $file).Hash.ToUpperInvariant()
  if ($expected[$name] -ne $actual) { throw "Checksum failed for $name" }
}

# Validate archive structure without extracting it.
docker run --rm -v "$(Resolve-Path $uploads):/backup/uploads.tar.gz:ro" alpine tar tzf /backup/uploads.tar.gz | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Uploads archive is not readable" }
if ((Get-Item -LiteralPath $sql).Length -lt 100) { throw "Database dump is unexpectedly small" }
Write-Host "[backup] Integrity checks passed for $Timestamp."
