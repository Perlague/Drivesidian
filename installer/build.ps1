<#
.SYNOPSIS
  Arma el instalador del agente de Drivesidian.

.DESCRIPTION
  Produce dist\DrivesidianAgentSetup.exe: un bootstrapper de WiX Burn que
  encadena el instalador oficial de Node.js con el MSI del agente.

  Requisitos:
    dotnet tool install --global wix --version 5.0.2
    wix extension add --global WixToolset.BootstrapperApplications.wixext/5.0.2

  Ojo con la version de WiX: la 7 exige aceptar la licencia de la Open Source
  Maintenance Fee, que es de pago segun el caso. La 5 es MIT y no pide nada.
  La extension tiene que coincidir en version con la herramienta.

.PARAMETER ApiUrl
  URL publica del servidor. Se escribe en el config.json que se empaqueta, para
  que el agente sepa contra quien vincularse la primera vez que arranca.

.EXAMPLE
  .\build.ps1 -ApiUrl https://drivesidian.ejemplo.com
#>

param(
  [Parameter(Mandatory = $true)]
  [string]$ApiUrl,

  [string]$Version = "0.1.0",

  # LTS de Node que se encadena. Al subirla, comprobar que la URL existe:
  # https://nodejs.org/dist/
  [string]$NodeVersion = "22.20.0"
)

$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $PSScriptRoot
$aqui = $PSScriptRoot
$staging = Join-Path $aqui "staging"
$redist = Join-Path $aqui "redist"
$dist = Join-Path $aqui "dist"
$nodeMsi = "node-v$NodeVersion-x64.msi"

Write-Host "=== 1/5 Limpiando ===" -ForegroundColor Cyan
Remove-Item $staging, $dist -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $staging, $redist, $dist | Out-Null

Write-Host "=== 2/5 Preparando los archivos del agente ===" -ForegroundColor Cyan
Copy-Item (Join-Path $raiz "agent\src") $staging -Recurse
Copy-Item (Join-Path $raiz "agent\package.json") $staging
Copy-Item (Join-Path $aqui "launch-agent.vbs") $staging
Copy-Item (Join-Path $aqui "install-startup.vbs") $staging
Copy-Item (Join-Path $aqui "uninstall-startup.vbs") $staging
Copy-Item (Join-Path $aqui "register-task.cmd") $staging
Copy-Item (Join-Path $aqui "unregister-task.cmd") $staging

# El agente lee apiUrl de aqui la primera vez. El token y el vault los rellena
# el propio agente al vincularse; este archivo solo siembra la URL.
@{ apiUrl = $ApiUrl } | ConvertTo-Json | Set-Content (Join-Path $staging "config.default.json") -Encoding utf8

Write-Host "=== 3/5 Resolviendo node_modules ===" -ForegroundColor Cyan
# --node-linker=hoisted es OBLIGATORIO: el layout por defecto de pnpm son
# enlaces simbolicos a node_modules\.pnpm, y los enlaces no sobreviven al
# empaquetado en un MSI. Con hoisted queda un arbol de archivos de verdad.
Copy-Item (Join-Path $raiz "agent\pnpm-lock.yaml") $staging
Push-Location $staging
try {
  pnpm install --prod --frozen-lockfile --node-linker=hoisted --ignore-scripts
  if ($LASTEXITCODE -ne 0) { throw "pnpm install fallo" }
} finally { Pop-Location }
Remove-Item (Join-Path $staging "pnpm-lock.yaml") -ErrorAction SilentlyContinue

# Solo importan los enlaces SIMBOLICOS y las uniones: son puntos de reanalisis
# y no sobreviven al empaquetado. Los hard links que deja pnpm apuntando a su
# almacen si estan bien: en NTFS son contenido de archivo real, y WiX los lee
# como cualquier otro archivo.
$reparse = Get-ChildItem $staging -Recurse -Force |
  Where-Object { $_.LinkType -in @("SymbolicLink", "Junction") } | Select-Object -First 1
if ($reparse) { throw "Quedaron enlaces simbolicos en el staging: $($reparse.FullName)" }

Write-Host "=== 4/5 Descargando Node.js $NodeVersion ===" -ForegroundColor Cyan
$destinoMsi = Join-Path $redist $nodeMsi
if (Test-Path $destinoMsi) {
  Write-Host "    ya estaba descargado"
} else {
  # Se descarga en tiempo de BUILD, no de instalacion: asi Burn lo incrusta y
  # el instalador funciona sin internet. WiX calcula el hash solo; nunca se
  # escribe uno a mano.
  Invoke-WebRequest -Uri "https://nodejs.org/dist/v$NodeVersion/$nodeMsi" -OutFile $destinoMsi
}

Write-Host "=== 5/5 Compilando con WiX ===" -ForegroundColor Cyan
$msiPath = Join-Path $dist "DrivesidianAgent.msi"
$icono = Join-Path $aqui "icono.ico"

# El icono se genera desde codigo (make-icon.js) para poder revisar que dibuja
# y cambiarlo sin abrir un editor grafico.
if (-not (Test-Path $icono)) {
  node (Join-Path $aqui "make-icon.js")
  if ($LASTEXITCODE -ne 0) { throw "No se pudo generar el icono" }
}

wix build (Join-Path $aqui "Package.wxs") `
  -define "Version=$Version" `
  -define "StagingDir=$staging" `
  -arch x64 `
  -out $msiPath
if ($LASTEXITCODE -ne 0) { throw "La compilacion del MSI fallo" }

wix build (Join-Path $aqui "Bundle.wxs") `
  -define "Version=$Version" `
  -define "StagingDir=$staging" `
  -define "RedistDir=$redist" `
  -define "NodeMsi=$nodeMsi" `
  -define "MsiPath=$msiPath" `
  -define "IconPath=$icono" `
  -ext WixToolset.BootstrapperApplications.wixext `
  -arch x64 `
  -out (Join-Path $dist "DrivesidianAgentSetup.exe")
if ($LASTEXITCODE -ne 0) { throw "La compilacion del bundle fallo" }

Write-Host ""
Write-Host "Listo: $(Join-Path $dist 'DrivesidianAgentSetup.exe')" -ForegroundColor Green
Write-Host ""
Write-Host "El instalador NO esta firmado digitalmente: firmarlo requiere un" -ForegroundColor Yellow
Write-Host "certificado de code signing de pago. Windows SmartScreen va a" -ForegroundColor Yellow
Write-Host "mostrar una advertencia la primera vez. Esta documentado en el" -ForegroundColor Yellow
Write-Host "README; no intentes suprimirla." -ForegroundColor Yellow
