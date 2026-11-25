# Packs every clip listed in audio\manifest.json into one file, audio-pack.js,
# so the game loads all its voices in a single request. Run after make-audio.ps1.
$ErrorActionPreference = 'Stop'
$root  = Split-Path $PSScriptRoot -Parent
$audio = Join-Path $root "audio"
$manifest = Get-Content (Join-Path $audio "manifest.json") -Raw | ConvertFrom-Json -AsHashtable
$data = [ordered]@{}
$missing = @()
foreach ($file in $manifest.seconds.Keys) {
  $path = Join-Path $audio ($file -replace '/', '\')
  if (Test-Path $path) { $data[$file] = [Convert]::ToBase64String([IO.File]::ReadAllBytes($path)) } else { $missing += $file }
}
$js = "window.IP_AUDIO=" + (([ordered]@{ manifest = $manifest; data = $data }) | ConvertTo-Json -Depth 10 -Compress) + ";"
$out = Join-Path $root "audio-pack.js"
[IO.File]::WriteAllText($out, $js, [Text.UTF8Encoding]::new($false))
"packed $($data.Count) clips into $out ({0} MB), missing: $($missing.Count)" -f [Math]::Round((Get-Item $out).Length / 1MB, 1)
$missing | ForEach-Object { "  missing $_" }
