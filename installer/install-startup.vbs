' Crea el acceso directo del agente en la carpeta de Inicio del usuario.
'
' Es la via de respaldo cuando no hay permisos para registrar una tarea
' programada con disparador de inicio de sesion. Ventaja sobre schtasks: apunta
' al usuario correcto por construccion, porque la carpeta esta dentro de su
' propio perfil, sin tener que pasarle /RU ningun nombre de cuenta.

Option Explicit

Dim shell, fso, carpeta, lanzador, inicio, acceso, atajo

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

carpeta = fso.GetParentFolderName(WScript.ScriptFullName)
lanzador = fso.BuildPath(carpeta, "launch-agent.vbs")

If Not fso.FileExists(lanzador) Then
  WScript.Echo "[startup] No se encuentra " & lanzador
  WScript.Quit 1
End If

inicio = shell.SpecialFolders("Startup")
acceso = fso.BuildPath(inicio, "Drivesidian Agent.lnk")

Set atajo = shell.CreateShortcut(acceso)
atajo.TargetPath = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\wscript.exe")
atajo.Arguments = """" & lanzador & """"
atajo.WorkingDirectory = carpeta
atajo.Description = "Sincroniza tus notas de Obsidian con Drivesidian"
atajo.Save

WScript.Echo "[startup] Acceso directo creado en " & acceso
WScript.Quit 0
