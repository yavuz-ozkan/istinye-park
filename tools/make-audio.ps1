# Makes every spoken clip for the game from audio\lines.json with ElevenLabs.
#   pwsh -File tools\make-audio.ps1 -DryRun     count clips and characters, spend nothing
#   pwsh -File tools\make-audio.ps1             make the clips that are missing
# Existing clips are kept, so it is safe to run again after adding lines.
# The API key is read from elevenlabs-key.txt in the folder ABOVE this project, so it can never be committed with it.
param([switch]$DryRun, [string]$KeyFile)
$ErrorActionPreference = 'Stop'
$root  = Split-Path $PSScriptRoot -Parent
if (-not $KeyFile) { $KeyFile = Join-Path (Split-Path $root -Parent) "elevenlabs-key.txt" }
$audio = Join-Path $root "audio"
$cfg   = Get-Content (Join-Path $audio "lines.json") -Raw | ConvertFrom-Json

$clips = [System.Collections.Generic.List[object]]::new()
$replyFile = [ordered]@{}
function Add-Reply([string]$text) {
  if (-not $replyFile.Contains($text)) {
    $file = "r/r{0:000}.mp3" -f ($replyFile.Count + 1)
    $replyFile[$text] = $file
    $clips.Add([pscustomobject]@{ file = $file; voice = "reply"; tts = ($text -replace 'Noah', 'Noa'); text = $text })
  }
  $replyFile[$text]
}

$pairs = @(@("teyze","mark"), @("dede","gamze"), @("teyze","gamze"), @("dede","mark"))
$manifestRows = foreach ($row in $cfg.rows) {
  $voices = if ($row.g -eq 'family') { @("teyze","dede") } else { $pairs[$row.n % 4] }
  $letters = "abcdef"
  $i = 0
  $prompts = foreach ($s in $row.say) {
    $byVoice = [ordered]@{}
    foreach ($v in $voices) {
      $isOld = [bool]$cfg.voices.$v.old
      $text = if ($isOld -and $s.old) { $s.old } else { $s.t }
      $tag = ""
      if ($row.tag) { $tag = if ($isOld) { $cfg.tags.($row.tag).old } else { $cfg.tags.($row.tag).toon } }
      $file = "q/q{0:00}{1}-{2}.mp3" -f $row.n, $letters[$i], $v
      $clips.Add([pscustomobject]@{ file = $file; voice = $v; tts = (("$tag $text").Trim()); text = $text })
      $byVoice[$v] = [ordered]@{ text = $text; file = $file }
    }
    $i++
    [ordered]@{ text = $s.t; clips = $byVoice }
  }
  $replies = foreach ($r in $row.reply) { [ordered]@{ text = $r; file = (Add-Reply $r) } }
  [ordered]@{ n = $row.n; group = $row.g; meaning = $row.meaning; prompts = @($prompts); replies = @($replies) }
}

$manifestBaba = foreach ($b in $cfg.baba) {
  $file = "baba/$($b.id).mp3"
  $clips.Add([pscustomobject]@{ file = $file; voice = "baba"; tts = $b.tts; text = $b.text })
  $replies = @(); if ($b.reply) { $replies = foreach ($r in $b.reply) { [ordered]@{ text = $r; file = (Add-Reply $r) } } }
  [ordered]@{ id = $b.id; text = $b.text; when = $b.when; file = $file; replies = @($replies) }
}
$manifestNarr = foreach ($x in $cfg.narration) {
  $file = "narr/$($x.id).mp3"
  $clips.Add([pscustomobject]@{ file = $file; voice = $x.voice; tts = $x.tts; text = $x.text })
  [ordered]@{ id = $x.id; text = $x.text; file = $file }
}

$chars = ($clips | ForEach-Object { $_.tts.Length } | Measure-Object -Sum).Sum
"clips: $($clips.Count)   characters to speak (tags included): $chars"
$clips | Group-Object voice | ForEach-Object { "  {0,-9} {1,4} clips {2,6} chars" -f $_.Name, $_.Count, ($_.Group | ForEach-Object { $_.tts.Length } | Measure-Object -Sum).Sum }
if ($DryRun) { return }

$key = (Get-Content $KeyFile -Raw).Trim()
$h = @{ 'xi-api-key' = $key }
$before = Invoke-RestMethod -Uri "https://api.elevenlabs.io/v1/user/subscription" -Headers $h
"credits before: used=$($before.character_count) left=$($before.character_limit - $before.character_count)"

$made = 0; $kept = 0; $failed = @()
foreach ($c in $clips) {
  $path = Join-Path $audio ($c.file -replace '/', '\')
  New-Item -ItemType Directory -Force (Split-Path $path -Parent) | Out-Null
  if ((Test-Path $path) -and (Get-Item $path).Length -gt 1000) { $kept++; continue }
  $body = [Text.Encoding]::UTF8.GetBytes((@{ text = $c.tts; model_id = $cfg.model; language_code = "tr" } | ConvertTo-Json -Compress))
  $ok = $false
  foreach ($try in 1..4) {
    try {
      Invoke-WebRequest -Uri "https://api.elevenlabs.io/v1/text-to-speech/$($cfg.voices.($c.voice).id)?output_format=$($cfg.format)" -Method Post -Headers $h -ContentType "application/json; charset=utf-8" -Body $body -OutFile $path | Out-Null
      $ok = $true; break
    } catch {
      $msg = "$($_.ErrorDetails.Message) $($_.Exception.Message)"
      if ($msg -match 'quota|insufficient|credit') { "STOPPED, out of credits: $($msg.Substring(0, [Math]::Min(200, $msg.Length)))"; $failed += $c.file; break }
      if ($try -eq 4) { $failed += "$($c.file): $($msg.Substring(0, [Math]::Min(160, $msg.Length)))" } else { Start-Sleep -Seconds (3 * $try) }
    }
  }
  if ($ok) { $made++ }
  if ($failed.Count -ge 5) { "STOPPED after 5 failures"; break }
}

# Clip lengths, and anything that looks wrong for its text (64 kbps is 8000 bytes a second)
$odd = @()
$sizes = [ordered]@{}
foreach ($c in $clips) {
  $path = Join-Path $audio ($c.file -replace '/', '\')
  if (-not (Test-Path $path)) { continue }
  $sec = [Math]::Round((Get-Item $path).Length / 8000, 1)
  $sizes[$c.file] = $sec
  $plain = ($c.tts -replace '\[[^\]]*\]', '').Trim()
  if ($sec -lt 0.4 -or $sec -gt (2.5 + 0.13 * $plain.Length)) { $odd += "{0}  {1}s  '{2}'" -f $c.file, $sec, $c.tts }
}

$manifest = [ordered]@{
  model = $cfg.model; voices = $cfg.voices
  rows = @($manifestRows); baba = @($manifestBaba); narration = @($manifestNarr); seconds = $sizes
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $audio "manifest.json") -Encoding utf8

$after = Invoke-RestMethod -Uri "https://api.elevenlabs.io/v1/user/subscription" -Headers $h
"made=$made kept=$kept failed=$($failed.Count)"
$failed | ForEach-Object { "  FAILED $_" }
"credits after: used=$($after.character_count) left=$($after.character_limit - $after.character_count) (this run spent $($after.character_count - $before.character_count))"
"total audio: {0} MB in {1} files" -f [Math]::Round(((Get-ChildItem $audio -Recurse -Filter *.mp3 | Where-Object { $_.DirectoryName -notmatch 'samples' } | Measure-Object Length -Sum).Sum / 1MB), 1), $sizes.Count
"clips with an unusual length: $($odd.Count)"
$odd | ForEach-Object { "  $_" }
