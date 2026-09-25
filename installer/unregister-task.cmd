@echo off
REM Desinstalacion: desvincula el equipo y quita el arranque automatico.
REM
REM Sale SIEMPRE con 0. Un fallo aqui —sin red, servidor caido, tarea ya
REM borrada— no debe abortar la desinstalacion ni dejarla a medias.

setlocal

set "TAREA=Drivesidian Agent"

REM Primero se detiene el agente, para que no este escribiendo mientras se
REM borran sus archivos.
schtasks /End /TN "%TAREA%" >nul 2>&1
schtasks /Delete /TN "%TAREA%" /F >nul 2>&1
taskkill /F /IM wscript.exe /FI "WINDOWTITLE eq Drivesidian*" >nul 2>&1

REM Se quitan las dos vias de arranque, porque no se sabe cual se uso al
REM instalar (ver register-task.cmd).
cscript //nologo "%~dp0uninstall-startup.vbs" >nul 2>&1

REM Revoca el acceso en el servidor y borra el config.json local, para no dejar
REM una credencial viva ni en la base ni en el disco. Tiene que correr ANTES de
REM que el instalador borre los archivos de la aplicacion.
set "NODE=%ProgramFiles%\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node.exe"

"%NODE%" "%~dp0src\unpair.js" >nul 2>&1

exit /b 0
