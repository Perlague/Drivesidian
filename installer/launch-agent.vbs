' Lanza el agente sin ventana de consola.
'
' La tarea programada no puede invocar node.exe directamente: al iniciar sesión
' aparecería una ventana negra que el usuario no entiende y que puede cerrar
' por accidente, matando el agente. WScript.Shell.Run con estilo de ventana 0
' lo arranca oculto.

Option Explicit

Dim shell, fso, carpeta, nodeExe, agente

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

carpeta = fso.GetParentFolderName(WScript.ScriptFullName)
agente = fso.BuildPath(carpeta, "src\index.js")

' El bundle instala Node.js en su ruta estándar. Si alguien lo movió o ya lo
' tenía en otro sitio, se cae al PATH.
nodeExe = shell.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe")
If Not fso.FileExists(nodeExe) Then
  nodeExe = "node.exe"
End If

If Not fso.FileExists(agente) Then
  WScript.Quit 1
End If

' 0 = ventana oculta, False = no esperar a que termine.
shell.Run """" & nodeExe & """ """ & agente & """", 0, False
