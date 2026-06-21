# download-style-textures.ps1
# Downloads PBR texture sets from Poly Haven (CC0) for the four style presets.
# Textures not already present in assets/textures/ will be downloaded.
# Run from the project root: .\scripts\download-style-textures.ps1

$ErrorActionPreference = "Continue"
$base = "assets\textures"
$polyHaven = "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k"

# List of texture slugs needed by STYLE_TEXTURES in bp3d-material-factory.js
# Format: @{ Slug = "poly-haven-id"; Files = @("diff","nor_gl","rough") }
$sets = @(
  @{ Slug = "travertine_rock";   PH = "travertine_rock" },
  @{ Slug = "volcanic_rock";     PH = "volcanic_rock" },
  @{ Slug = "metal_plate";       PH = "metal_plate" },
  @{ Slug = "black_slate";       PH = "black_slate" },
  @{ Slug = "linen_fabric";      PH = "fabric_pattern_05" },
  @{ Slug = "light_oak_wood";    PH = "wood_floor_deck" }
)

# Texture types to download for each set
$types = @(
  @{ Suffix = "diff_1k";   Ext = "jpg" },
  @{ Suffix = "nor_gl_1k"; Ext = "jpg" },
  @{ Suffix = "rough_1k";  Ext = "jpg" }
)

$total = 0
$skipped = 0
$failed = 0

foreach ($set in $sets) {
  $dir = Join-Path $base $set.Slug
  if (-not (Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    Write-Host "  Created  $dir"
  }

  foreach ($t in $types) {
    $fileName  = "$($set.Slug)_$($t.Suffix).$($t.Ext)"
    $localPath = Join-Path $dir $fileName

    if (Test-Path $localPath) {
      $skipped++
      continue
    }

    # Poly Haven file URL pattern:
    # https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/{ph-id}/{ph-id}_{suffix}.jpg
    $phFile = "$($set.PH)_$($t.Suffix).$($t.Ext)"
    $url = "$polyHaven/$($set.PH)/$phFile"

    Write-Host "  Downloading $fileName ..." -NoNewline
    try {
      Invoke-WebRequest -Uri $url -OutFile $localPath -UseBasicParsing -TimeoutSec 60
      Write-Host " OK"
      $total++
    } catch {
      # Some slugs differ slightly on Poly Haven — try alternate naming
      $altUrl = "$polyHaven/$($set.PH)/$($set.PH)_$($t.Suffix).$($t.Ext)"
      try {
        Invoke-WebRequest -Uri $altUrl -OutFile $localPath -UseBasicParsing -TimeoutSec 60
        Write-Host " OK (alt)"
        $total++
      } catch {
        Write-Host " FAILED ($_)"
        $failed++
        # Remove empty file left by failed download
        if (Test-Path $localPath) { Remove-Item $localPath -Force }
      }
    }
  }
}

Write-Host ""
Write-Host "Done. Downloaded: $total  Skipped (already exist): $skipped  Failed: $failed"
if ($failed -gt 0) {
  Write-Host "Failed textures will fall back to procedural textures in the renderer."
}
