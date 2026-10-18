; Fudebako — NSIS installer hooks
; Adds "Edit with Fudebako" to the Explorer right-click menu of Markdown/text files.
; SHCTX = HKCU for per-user installs, HKLM for per-machine installs.

!macro FudebakoAddVerb EXT
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\${EXT}\shell\Fudebako" "" "Edit with Fudebako"
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\${EXT}\shell\Fudebako" "Icon" '"$INSTDIR\${MAINBINARYNAME}.exe",0'
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\${EXT}\shell\Fudebako\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
!macroend

!macro FudebakoRemoveVerb EXT
  DeleteRegKey SHCTX "Software\Classes\SystemFileAssociations\${EXT}\shell\Fudebako"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro FudebakoAddVerb ".md"
  !insertmacro FudebakoAddVerb ".markdown"
  !insertmacro FudebakoAddVerb ".mdown"
  !insertmacro FudebakoAddVerb ".mkd"
  !insertmacro FudebakoAddVerb ".txt"
  ; tell Explorer to refresh its associations
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro FudebakoRemoveVerb ".md"
  !insertmacro FudebakoRemoveVerb ".markdown"
  !insertmacro FudebakoRemoveVerb ".mdown"
  !insertmacro FudebakoRemoveVerb ".mkd"
  !insertmacro FudebakoRemoveVerb ".txt"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
