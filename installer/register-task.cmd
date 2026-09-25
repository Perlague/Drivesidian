@echo off
REM Hace que el agente arranque en cada inicio de sesion del usuario.
REM
REM Lo invoca el instalador como Custom Action, IMPERSONADA: tiene que correr
REM como el usuario que instala, no como SYSTEM, porque el agente necesita su
REM %APPDATA% y su vault.
REM
REM Se intentan dos vias, en este orden:
REM
REM   1. Tarea programada con /SC ONLOGON. Es lo que describe el diseno, pero
REM      Windows EXIGE elevacion para registrar un disparador de inicio de
REM      sesion (verificado: /SC DAILY pasa sin elevar, /SC ONLOGON no).
REM   2. Acceso directo en la carpeta de Inicio del usuario. No necesita
REM      permisos de administrador y apunta al usuario correcto por
REM      construccion, porque es una ruta dentro de su propio perfil.
REM
REM El escapado de /TR vive en un archivo y no dentro de un atributo XML porque
REM es delicado: /TR necesita TODO el comando entre comillas, con las internas
REM escapadas como \".

setlocal

set "TAREA=Drivesidian Agent"
set "LANZADOR=%~dp0launch-agent.vbs"

if not exist "%LANZADOR%" (
  echo [register] No se encuentra el lanzador: %LANZADOR%
  exit /b 1
)

schtasks /Create /F /SC ONLOGON /TN "%TAREA%" /TR "wscript.exe \"%LANZADOR%\"" >nul 2>&1
if not errorlevel 1 (
  echo [register] Tarea programada "%TAREA%" registrada.
  schtasks /Run /TN "%TAREA%" >nul 2>&1
  goto :fin
)

echo [register] Sin permisos para crear la tarea programada; usando la carpeta de Inicio.
cscript //nologo "%~dp0install-startup.vbs"
if errorlevel 1 (
  echo [register] No se pudo configurar el arranque automatico.
  exit /b 1
)

REM Se arranca ya, para que el usuario no tenga que cerrar sesion y volver a
REM entrar para que el agente empiece a funcionar.
start "" wscript.exe "%LANZADOR%"

:fin
exit /b 0
