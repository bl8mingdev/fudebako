<#
  Adds (or removes) "Edit with Fudebako" in the Explorer right-click menu — no admin needed.
  Use this for a portable / self-built fudebako.exe. The installer does this automatically.

    powershell -ExecutionPolicy Bypass -File scripts\context-menu.ps1 -Exe "C:\Apps\Fudebako\fudebako.exe"
    powershell -ExecutionPolicy Bypass -File scripts\context-menu.ps1 -Remove
#>
param(
  [string]$Exe = "$env:LOCALAPPDATA\Fudebako\fudebako.exe",
  [switch]$Remove
)
$exts = '.md', '.markdown', '.mdown', '.mkd', '.txt'
foreach ($ext in $exts) {
  $key = "HKCU:\Software\Classes\SystemFileAssociations\$ext\shell\Fudebako"
  if ($Remove) {
    Remove-Item -Path $key -Recurse -Force -ErrorAction SilentlyContinue
    continue
  }
  if (-not (Test-Path $Exe)) { Write-Error "fudebako.exe not found at $Exe (pass -Exe <path>)"; exit 1 }
  New-Item -Path "$key\command" -Force | Out-Null
  Set-Item -Path $key -Value 'Edit with Fudebako'
  New-ItemProperty -Path $key -Name 'Icon' -Value "`"$Exe`",0" -PropertyType String -Force | Out-Null
  Set-Item -Path "$key\command" -Value "`"$Exe`" `"%1`""
}
if ($Remove) { 'Removed "Edit with Fudebako" from the context menu.' } else { "Added ""Edit with Fudebako"" for $($exts -join ', ')." }
