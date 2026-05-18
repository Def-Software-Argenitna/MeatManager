; MeatManager PRO Installer Script (NSIS)
; With custom uninstall dialogs for database preservation

!include "MUI2.nsh"
!include "x64.nsh"

; General settings
Name "MeatManager PRO"
OutFile "$%TEMP%\MeatManager_PRO_Setup.exe"
InstallDir "$PROGRAMFILES\MeatManager PRO"

; Uninstaller settings
!define MUI_WELCOMEFINISHPAGE_BITMAP "${NSISDIR}\Contrib\Graphics\Wizard\nsis3-wizard.bmp"

; Pages
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; Language
!insertmacro MUI_LANGUAGE "Spanish"

; Installation
Section "Instalar"
  SetOutPath "$INSTDIR"
  File /r "dist_electron\*.*"
SectionEnd

; Uninstaller section
Section "Uninstall"
  ; Remove application files
  RMDir /r "$INSTDIR"
  RMDir /r "$SMPROGRAMS\MeatManager PRO"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MeatManager PRO"
  
  ; Database location
  ${If} ${RunningX64}
    StrCpy $0 "$PROGRAMFILES(x86)\MeatManager PRO"
  ${Else}
    StrCpy $0 "$PROGRAMFILES\MeatManager PRO"
  ${EndIf}
  
  ; Ask user about database
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "¿Deseas BORRAR los datos de la base de datos?$\n$\n⚠️ Si seleccionas SÍ, se perderán todos los registros (ventas, stock, clientes, etc.).$\n$\nSi seleccionas NO, los datos se preservarán para una reinstalación futura." \
    /SD IDNO IDYES DeleteDB IDNO KeepDB
  
  DeleteDB:
    ; Confirm deletion
    MessageBox MB_YESNO|MB_ICONWARNING \
      "⚠️ ¿ESTÁS SEGURO?$\n$\nEsta acción es irreversible y se borrarán TODOS los datos de la carnicería." \
      IDYES ConfirmDelete IDNO SkipDelete
    
    ConfirmDelete:
      ; Delete IndexedDB (Dexie stores data here)
      RMDir /r "$PROFILE\AppData\Local\MeatManager PRO"
      RMDir /r "$APPDATA\MeatManager PRO"
      MessageBox MB_OK|MB_ICONINFORMATION "✅ Base de datos eliminada completamente."
      Goto SkipDelete
    
    SkipDelete:
  
  KeepDB:
    MessageBox MB_OK|MB_ICONINFORMATION \
      "✅ Los datos han sido preservados.$\n$\nSi reinstalá MeatManager PRO en el futuro, todos tus datos volverán a estar disponibles."
  
SectionEnd
