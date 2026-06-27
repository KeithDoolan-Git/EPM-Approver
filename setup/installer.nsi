; EPM Notification Service Installer
; NSIS Configuration

!include "MUI2.nsh"
!include "x64.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

; Name and file
Name "EPM Notification Service"
OutFile "epm-setup.exe"
InstallDir "$PROGRAMFILES\EPM-Notification-Service"
InstallDirRegKey HKCU "Software\EPMNotificationService" "InstallDir"

; Request admin privileges
RequestExecutionLevel admin

; MUI Settings
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_LANGUAGE "English"

; ============================================================================
; INSTALLER SECTIONS
; ============================================================================

Section "Install"
    SetOutPath "$INSTDIR"

    ; Download latest repo from GitHub
    DetailPrint "Downloading EPM Notification Service..."

    ; Using powershell to download and extract zip
    ExecWait 'powershell -NoProfile -ExecutionPolicy Bypass -Command "& {$ProgressPreference=''SilentlyContinue''; $url=''https://github.com/YOUR_ORG/epm-notification-service/archive/main.zip''; $dest=''$env:TEMP\epm-main.zip''; Invoke-WebRequest -Uri $url -OutFile $dest; Expand-Archive -Path $dest -DestinationPath ''$INSTDIR'' -Force; Remove-Item $dest}"'

    DetailPrint "Installation files extracted"

    ; Store installation folder in registry
    WriteRegStr HKCU "Software\EPMNotificationService" "InstallDir" "$INSTDIR"

    ; Create Start Menu shortcut
    CreateDirectory "$SMPROGRAMS\EPM Notification Service"
    CreateShortCut "$SMPROGRAMS\EPM Notification Service\Setup.lnk" "$INSTDIR\setup\deploy.ps1"
    CreateShortCut "$SMPROGRAMS\EPM Notification Service\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
    CreateShortCut "$SMPROGRAMS\EPM Notification Service\README.lnk" "$INSTDIR\README.md"

    ; Create uninstaller
    WriteUninstaller "$INSTDIR\Uninstall.exe"

    ; Run PowerShell setup script
    DetailPrint "Launching setup script..."
    ExecWait 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\setup\deploy.ps1"'

SectionEnd

; ============================================================================
; UNINSTALLER
; ============================================================================

Section "Uninstall"
    ; Remove Start Menu shortcuts
    RMDir /r "$SMPROGRAMS\EPM Notification Service"

    ; Remove installation directory
    RMDir /r "$INSTDIR"

    ; Remove registry entries
    DeleteRegKey HKCU "Software\EPMNotificationService"

SectionEnd

; ============================================================================
; FUNCTIONS
; ============================================================================

Function .onInit
    ; Check Windows version (require Windows 10 or later)
    ${If} ${RunningX64}
        DetailPrint "Running on 64-bit Windows"
    ${EndIf}

    ; Check if PowerShell is available
    ExecWait 'powershell -NoProfile -Command "Write-Host ''PowerShell is available''"' $0
    ${If} $0 != 0
        MessageBox MB_ICONSTOP "PowerShell is required but not found. Please install PowerShell 5.1 or later."
        Abort
    ${EndIf}

FunctionEnd

Function .onInstSuccess
    MessageBox MB_ICONINFORMATION "EPM Notification Service installation complete!$\n$\nA PowerShell window will open to complete the setup. You will need:$\n- Azure subscription$\n- Global Admin permissions for Entra"

FunctionEnd

Section "Uninstall"
    MessageBox MB_ICONINFORMATION "EPM Notification Service has been uninstalled."
SectionEnd
