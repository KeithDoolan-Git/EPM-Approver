; EPM Notification Service Installer
; Self-contained NSIS installer: bundles the project source and launches the
; PowerShell deployment script. Built in CI (see .github/workflows/build-installer.yml).

!include "MUI2.nsh"
!include "LogicLib.nsh"

Name "EPM Notification Service"
OutFile "epm-setup.exe"
InstallDir "$PROGRAMFILES64\EPM-Notification-Service"
InstallDirRegKey HKCU "Software\EPMNotificationService" "InstallDir"
RequestExecutionLevel admin

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "English"

; ============================================================================
; INSTALL
; ============================================================================
Section "Install"
    SetOutPath "$INSTDIR"

    ; Bundle the project files. Paths are relative to THIS script's directory
    ; (${__FILEDIR__}) so the build works regardless of makensis' working dir.
    ; A fresh git checkout has no node_modules/dist/.git, so nothing to exclude.
    File /r "${__FILEDIR__}\..\src"
    File /r "${__FILEDIR__}\..\setup"
    File "${__FILEDIR__}\..\package.json"
    File "${__FILEDIR__}\..\tsconfig.json"
    File "${__FILEDIR__}\..\host.json"
    File "${__FILEDIR__}\..\README.md"

    WriteRegStr HKCU "Software\EPMNotificationService" "InstallDir" "$INSTDIR"

    CreateDirectory "$SMPROGRAMS\EPM Notification Service"
    CreateShortCut "$SMPROGRAMS\EPM Notification Service\Run Setup.lnk" "powershell.exe" "-NoProfile -ExecutionPolicy Bypass -File ""$INSTDIR\setup\deploy.ps1"""
    CreateShortCut "$SMPROGRAMS\EPM Notification Service\README.lnk" "$INSTDIR\README.md"
    CreateShortCut "$SMPROGRAMS\EPM Notification Service\Uninstall.lnk" "$INSTDIR\Uninstall.exe"

    WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

; ============================================================================
; UNINSTALL
; ============================================================================
Section "Uninstall"
    RMDir /r "$SMPROGRAMS\EPM Notification Service"
    RMDir /r "$INSTDIR"
    DeleteRegKey HKCU "Software\EPMNotificationService"
SectionEnd

; ============================================================================
; HOOKS
; ============================================================================
Function .onInit
    ; PowerShell is required to run the deployment script.
    nsExec::ExecToStack 'powershell -NoProfile -Command "exit 0"'
    Pop $0
    ${If} $0 != 0
        MessageBox MB_ICONSTOP "PowerShell 5.1+ is required but was not found."
        Abort
    ${EndIf}
FunctionEnd

Function .onInstSuccess
    MessageBox MB_YESNO "Installation complete.$\n$\nRun the Azure setup now?$\n$\nYou will need:$\n - An Azure subscription$\n - Global Admin (to create the app registration)$\n - Node.js, Azure CLI, and Azure Functions Core Tools installed" IDNO skipRun
        Exec 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\setup\deploy.ps1"'
    skipRun:
FunctionEnd
