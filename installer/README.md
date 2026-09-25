# Instalador del agente (Windows)

Produce `dist\DrivesidianAgentSetup.exe`: un bootstrapper de WiX Burn que
encadena el instalador oficial de Node.js con el MSI del agente. El usuario
final descarga **un archivo**, lo ejecuta, y no necesita tener Node instalado.

## Construirlo

```powershell
dotnet tool install --global wix --version 5.0.2
wix extension add --global WixToolset.BootstrapperApplications.wixext/5.0.2

.\build.ps1 -ApiUrl https://drivesidian.ejemplo.com
```

`-ApiUrl` se escribe en el `config.default.json` que va dentro del paquete: es
contra ese servidor que el agente se vinculará la primera vez que arranque.

**Usa WiX 5, no la 7.** La versión 7 exige aceptar la licencia de la *Open
Source Maintenance Fee*, que es de pago según el caso. La 5 es MIT. La extensión
del bootstrapper tiene que coincidir en versión con la herramienta.

## Qué hace el instalador

1. Instala Node.js si no está (el `.msi` oficial va incrustado, así que funciona
   sin internet). Marcado como `Permanent`: **desinstalar Drivesidian no se
   lleva Node por delante**, porque el usuario pudo tenerlo ya o depender de él.
2. Copia el agente a `C:\Program Files\Drivesidian`, con `node_modules` ya
   resuelto.
3. Registra el arranque automático en cada inicio de sesión.

**No pregunta nada.** Ni token ni ruta del vault: eso lo resuelve la vinculación
por código, abriendo el navegador la primera vez que el agente arranca.

## Arranque automático: dos vías

`register-task.cmd` intenta primero una tarea programada con `/SC ONLOGON`, que
es lo que describe el diseño. Si falla, crea un acceso directo en la carpeta de
Inicio del usuario.

El respaldo existe porque **Windows exige elevación para registrar un disparador
de inicio de sesión**. Verificado: `/SC DAILY` se crea sin elevar, `/SC ONLOGON`
devuelve `Access is denied`. Y no basta con elevar la Custom Action: si corre
como SYSTEM, la tarea quedaría registrada para SYSTEM, que no es quien tiene el
vault ni el `%APPDATA%` donde vive la configuración. Por eso la acción corre
impersonada, y por eso hace falta el plan B.

La carpeta de Inicio no tiene ese problema: está dentro del perfil del usuario,
así que apunta a la cuenta correcta por construcción y no necesita permisos.

Las dos vías se limpian al desinstalar, porque no se sabe cuál se usó.

## SmartScreen

El instalador **no está firmado digitalmente**: firmarlo requiere un certificado
de code signing de pago. Windows SmartScreen va a mostrar una advertencia la
primera vez, con un botón "Más información" → "Ejecutar de todas formas".

Está documentado con captura en el README principal. **No intentar suprimirla**:
la advertencia es correcta y el usuario merece verla.

## Archivos

| Archivo | Qué es |
|---|---|
| `build.ps1` | Script de build: staging, `node_modules`, descarga de Node, WiX |
| `Package.wxs` | El MSI del agente y sus Custom Actions |
| `Bundle.wxs` | El bootstrapper de Burn que encadena Node.js + el MSI |
| `launch-agent.vbs` | Arranca el agente **sin ventana de consola** |
| `register-task.cmd` | Tarea programada, con respaldo en la carpeta de Inicio |
| `unregister-task.cmd` | Desvincula el equipo y quita el arranque automático |
| `install-startup.vbs` / `uninstall-startup.vbs` | El respaldo de la carpeta de Inicio |
| `make-icon.js` | Genera `icono.ico` desde código, sin editor gráfico |

`dist/`, `staging/`, `redist/` e `icono.ico` son artefactos de build y no se
versionan.

## Detalles que costaron

**`node_modules` necesita `--node-linker=hoisted`.** El layout por defecto de
pnpm son enlaces simbólicos a `node_modules\.pnpm`, y los enlaces simbólicos no
sobreviven al empaquetado en un MSI. Los *hard links* que pnpm deja apuntando a
su almacén sí están bien: en NTFS son contenido de archivo real.

**Los `.cmd` y `.vbs` exigen CRLF.** Con finales de línea LF, `cmd.exe` se come
el primer carácter de cada línea y falla con errores que no apuntan al problema
(`'M' is not recognized...` en vez de `REM`). Está fijado en `.gitattributes`.

**El orden de las Custom Actions importa.** Verificado en el MSI compilado:

```
3499  QuitarArranque      <- ANTES de RemoveFiles: unpair.js todavía existe
3500  RemoveFiles
4000  InstallFiles
4001  RegistrarArranque   <- DESPUÉS: register-task.cmd ya está copiado
```

**El `.msi` de Node se descarga al construir, no al instalar.** Así Burn lo
incrusta, el instalador funciona sin internet, y WiX calcula el hash solo —
nunca se escribe uno a mano.
