# Backup the Nyashavee stack: Postgres dump + uploads volume archive.
# Usage: powershell -File scripts/backup.ps1  (run from the repo root)
#        Add -ComposeFile docker-compose.prod.yml for the prod stack.

param(
  [string]$ComposeFile = "docker-compose.yml",
  [string]$OutDir = "data/backups"
)

$ErrorActionPreference = "Stop"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$absOut = (Resolve-Path $OutDir).Path

Write-Host "[backup] Dumping Postgres..."
docker compose -f $ComposeFile exec -T postgres pg_dump -U nyashavee -d nyashavee | Out-File -Encoding utf8 "$OutDir/nyashavee-$timestamp.sql"
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed" }

Write-Host "[backup] Archiving uploads volume..."
$volume = docker volume ls -q --filter "name=uploads_data" | Select-Object -First 1
if (-not $volume) { throw "uploads_data volume not found" }
docker run --rm -v "${volume}:/data:ro" -v "${absOut}:/backup" alpine tar czf "/backup/uploads-$timestamp.tar.gz" -C /data .
if ($LASTEXITCODE -ne 0) { throw "uploads archive failed" }

Write-Host "[backup] Writing integrity manifest..."
$sqlFile = Join-Path $OutDir "nyashavee-$timestamp.sql"
$uploadsFile = Join-Path $OutDir "uploads-$timestamp.tar.gz"
@(
  (Get-FileHash -Algorithm SHA256 $sqlFile).Hash + "  " + (Split-Path $sqlFile -Leaf)
  (Get-FileHash -Algorithm SHA256 $uploadsFile).Hash + "  " + (Split-Path $uploadsFile -Leaf)
) | Set-Content -Encoding ascii (Join-Path $OutDir "manifest-$timestamp.sha256")

Write-Host "[backup] Done:"
Get-ChildItem $OutDir -Filter "*$timestamp*" | ForEach-Object { Write-Host "  $($_.Name)  $([math]::Round($_.Length/1KB)) KB" }
