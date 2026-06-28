; EPM Notification Service Installer
; Self-contained NSIS installer: bundles the project source and launches the
; PowerShell deployment script. Built in CI (see .github/workflows/build-installer.yml).
;
; IMPORTANT: File paths below are relative to the directory makensis is invoked
; from, which in CI is the repository root (the workflow runs
; `makensis setup/installer.nsi` from the repo root).

!include "MUI2.nsh"

; PROJECT_ROOT is the repo root (this script lives in <root>\setup).
!define PROJECT_ROOT "${__FILEDIR__}\.."

Name "EPM Notification Service"
; Write the installer to the repo root so CI can find it at epm-setup.exe.
OutFile "${PROJECT_ROOT}\epm-setup.exe"
InstallDir "$PROGRAMFILES64\EPM-Notification-Service"
InstallDirRegKey HKCU "Software\EPMNotificationService" "InstallDir"
RequestExecutionLevel admin

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; ============================================================================
; INSTALL
; ============================================================================
Section "Install"
    SetOutPath "$INSTDIR"

    ; Bundle the project source. A fresh git checkout has no
    ; node_modules/dist/.git, so there is nothing to exclude.
    File /r "${PROJECT_ROOT}\src"
    File /r "${PROJECT_ROOT}\setup"
    File "${PROJECT_ROOT}\package.json"
    File "${PROJECT_ROOT}\tsconfig.json"
    File "${PROJECT_ROOT}\host.json"
    File "${PROJECT_ROOT}\README.md"

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
Function .onInstSuccess
    MessageBox MB_YESNO "Installation complete.$\n$\nRun the Azure setup now?$\n$\nYou will need:$\n - An Azure subscription$\n - Global Admin (to create the app registration)$\n - Node.js, Azure CLI, and Azure Functions Core Tools installed" IDNO skipRun
        Exec 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\setup\deploy.ps1"'
    skipRun:
FunctionEnd
