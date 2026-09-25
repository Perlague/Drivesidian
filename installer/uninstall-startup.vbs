' Quita el acceso directo del agente de la carpeta de Inicio del usuario.
' Contraparte de install-startup.vbs. No falla si no existe.

Option Explicit

Dim shell, fso, acceso

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

acceso = fso.BuildPath(shell.SpecialFolders("Startup"), "Drivesidian Agent.lnk")

If fso.FileExists(acceso) Then
  fso.DeleteFile acceso, True
  WScript.Echo "[startup] Acceso directo eliminado."
End If

WScript.Quit 0
