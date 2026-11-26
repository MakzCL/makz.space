; SEND installer hooks (Tauri NSIS).
;
; Moving from the old Electron build: its updater runs this installer as
;   SEND-Setup-x.exe --updated /S --force-run
; so before installing we quietly remove the Electron copy (its uninstaller keeps user data),
; and afterwards start SEND again when --force-run was given.
; Electron's per-user install is registered under HKCU\Software\{appGuid}, where appGuid is
; electron-builder's UUIDv5 of the old appId "space.makz.syndo".
!define SEND_ELECTRON_KEY "Software\18ed92ce-f809-57dd-9069-2046a5d30b3c"

!macro NSIS_HOOK_PREINSTALL
  ReadRegStr $R8 HKCU "${SEND_ELECTRON_KEY}" "InstallLocation"
  ${If} $R8 != ""
  ${AndIf} ${FileExists} "$R8\Uninstall SEND.exe"
  ${AndIf} $R8 != $INSTDIR
    DetailPrint "Removing the previous SEND (Electron) build from $R8"
    nsis_tauri_utils::KillProcessCurrentUser "SEND.exe"
    Pop $R9
    Sleep 600
    ExecWait '"$R8\Uninstall SEND.exe" /currentuser /S _?=$R8'
    RMDir /r "$R8"
    DeleteRegKey HKCU "${SEND_ELECTRON_KEY}"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${GetOptions} $CMDLINE "--force-run" $R9
  ${IfNot} ${Errors}
    nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}.exe" ""
  ${EndIf}
!macroend
