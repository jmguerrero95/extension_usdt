$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$archivePath = Join-Path $root 'extension.zip'
$sourcePath = Join-Path $root 'extension'
$gradleWrapper = Join-Path $sourcePath 'gradlew.bat'

if (Test-Path $gradleWrapper) {
  & $gradleWrapper --stop | Out-Null
}

$cleanupPaths = @(
  'extension\.gradle',
  'extension\build\classes',
  'extension\build\generated',
  'extension\build\resources',
  'extension\build\tmp',
  'extension\stubs\build'
)

foreach ($relativePath in $cleanupPaths) {
  $fullPath = Join-Path $root $relativePath
  if (Test-Path $fullPath) {
    Remove-Item -LiteralPath $fullPath -Recurse -Force
  }
}

if (Test-Path $archivePath) {
  Remove-Item -LiteralPath $archivePath -Force
}

Compress-Archive -Path $sourcePath -DestinationPath $archivePath -CompressionLevel Optimal

Write-Host "Archivo generado: $archivePath"
