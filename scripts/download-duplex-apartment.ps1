param(
  [string]$OutputDir = "samples/duplex-apartment/raw"
)

$ErrorActionPreference = "Stop"

$repo = "buildingsmart-community/Community-Sample-Test-Files"
$basePath = "IFC 2.3.0.1 (IFC 2x3)/Duplex Apartment"
$rawBase = "https://raw.githubusercontent.com/$repo/main/$($basePath -replace ' ', '%20' -replace '\(', '%28' -replace '\)', '%29')"
$lfsBatchUrl = "https://github.com/$repo.git/info/lfs/objects/batch"

$files = @(
  "README.md",
  "2012-03-23-Duplex-Design.xlsx",
  "2012-03-23-Duplex-Handover.xlsx",
  "2020-11-11-DuplexArc.jpg",
  "2020-11-11-DuplexEle.jpg",
  "2020-11-11-DuplexMec.jpg",
  "2020-11-11-DuplexPlu.jpg",
  "Duplex_A_20110907.ifc",
  "Duplex_Electrical_20121207.ifc",
  "Duplex_MEP_20110907.ifc",
  "Duplex_M_20111024_ROOMS_AND_SPACES.ifc",
  "Duplex_Plumbing_20121113.ifc"
)

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

function Invoke-CurlDownload {
  param(
    [string]$Url,
    [string]$Path
  )

  & curl.exe --ssl-no-revoke -L -sS -o $Path $Url
  if ($LASTEXITCODE -ne 0) {
    throw "curl failed for $Url"
  }
}

function Get-LfsPointer {
  param([string]$Path)

  $text = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
  if (-not $text.StartsWith("version https://git-lfs.github.com/spec/v1")) {
    return $null
  }

  $oid = [regex]::Match($text, "oid sha256:([a-f0-9]+)").Groups[1].Value
  $size = [int64][regex]::Match($text, "size ([0-9]+)").Groups[1].Value
  return @{ oid = $oid; size = $size }
}

foreach ($file in $files) {
  $encodedFile = [uri]::EscapeDataString($file)
  $url = "$rawBase/$encodedFile"
  $target = Join-Path $OutputDir $file
  Write-Host "Downloading pointer/raw $file"
  Invoke-CurlDownload -Url $url -Path $target

  $pointer = Get-LfsPointer -Path $target
  if ($null -eq $pointer) {
    continue
  }

  Write-Host "Resolving LFS $file ($($pointer.size) bytes)"
  $body = @{
    operation = "download"
    transfers = @("basic")
    objects = @(@{
      oid = $pointer.oid
      size = $pointer.size
    })
  } | ConvertTo-Json -Depth 5

  $bodyPath = Join-Path $env:TEMP "duplex-lfs-body.json"
  $respPath = Join-Path $env:TEMP "duplex-lfs-response.json"
  Set-Content -LiteralPath $bodyPath -Value $body -Encoding ascii

  & curl.exe --ssl-no-revoke -L -sS `
    -H "Accept: application/vnd.git-lfs+json" `
    -H "Content-Type: application/vnd.git-lfs+json" `
    --data-binary "@$bodyPath" `
    -o $respPath `
    $lfsBatchUrl
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "LFS batch failed for ${file}; keeping pointer file"
    continue
  }

  $response = Get-Content -LiteralPath $respPath -Raw | ConvertFrom-Json
  if ($response.message) {
    Write-Warning "LFS download unavailable for ${file}: $($response.message)"
    continue
  }

  $downloadUrl = $response.objects[0].actions.download.href
  if (-not $downloadUrl) {
    Write-Warning "No LFS download URL for $file"
    continue
  }

  Invoke-CurlDownload -Url $downloadUrl -Path $target
}

Get-ChildItem -LiteralPath $OutputDir -File | Select-Object Name,Length
