# Download PBR texture sets from Poly Haven (CC0 public domain)
# Usage: powershell -ExecutionPolicy Bypass -File scripts/download-pbr-textures.ps1

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$root = Split-Path -Parent $PSScriptRoot
$outBase = Join-Path $root "assets" "textures"

$textures = @("beige_wall_001", "oak_veneer_01", "laminate_floor_02", "wood_table_001", "white_plaster_02")
$maps = @("diff", "nor_gl", "rough")

Write-Host "=== Poly Haven PBR Texture Downloader ===" -ForegroundColor Cyan
Write-Host "Output: $outBase"
Write-Host ""

foreach ($tex in $textures) {
    $dir = Join-Path $outBase $tex
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    Write-Host "[$tex]" -ForegroundColor Yellow

    foreach ($map in $maps) {
        $filename = "${tex}_${map}_1k.jpg"
        $filepath = Join-Path $dir $filename
        if (Test-Path $filepath) {
            Write-Host "  SKIP $filename (exists)"
            continue
        }
        $url = "https://dl.polyhaven.org/file/ph-assets/Textures/$tex/1k/$filename"
        try {
            Write-Host "  GET  $filename ... " -NoNewline
            Invoke-WebRequest -Uri $url -OutFile $filepath -UseBasicParsing
            $sz = [math]::Round((Get-Item $filepath).Length / 1KB)
            Write-Host "OK (${sz}KB)" -ForegroundColor Green
        } catch {
            if ($map -eq "nor_gl") {
                $pngUrl = "https://dl.polyhaven.org/file/ph-assets/Textures/$tex/1k/${tex}_${map}_1k.png"
                try {
                    Invoke-WebRequest -Uri $pngUrl -OutFile $filepath -UseBasicParsing
                    $sz = [math]::Round((Get-Item $filepath).Length / 1KB)
                    Write-Host "OK png (${sz}KB)" -ForegroundColor Green
                } catch {
                    Write-Host "FAILED" -ForegroundColor Red
                }
            } else {
                Write-Host "FAILED" -ForegroundColor Red
            }
        }
    }
}

Write-Host "`n=== Done ===" -ForegroundColor Cyan
