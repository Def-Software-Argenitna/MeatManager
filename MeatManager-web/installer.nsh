!macro customUnInstall
  ; Por defecto NO borrar datos. Solo si el usuario escribe explícitamente una confirmación.
  MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "⚠️ ADVERTENCIA: ¿Borrar la base de datos?$\r$\n$\r$\nEsto eliminará PERMANENTEMENTE ventas, stock, clientes y todos los registros.$\r$\n$\r$\nSolo hacer esto si vas a desinstalar definitivamente.$\r$\n$\r$\nSI = borrar TODO | NO = conservar datos (recomendado)" IDYES DoDelete
  Goto SkipDelete
  DoDelete:
  RMDir /r "$LOCALAPPDATA\MeatManager PRO"
  RMDir /r "$APPDATA\MeatManager PRO"
  RMDir /r "$LOCALAPPDATA\meatmanager"
  RMDir /r "$APPDATA\meatmanager"
  MessageBox MB_OK|MB_ICONINFORMATION "Base de datos eliminada."
  SkipDelete:
!macroend
