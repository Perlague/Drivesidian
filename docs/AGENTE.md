# Instalar el agente

El agente es un programa que vigila una carpeta de tu vault de Obsidian y sube
tus notas al servidor. Se instala una vez y se olvida: arranca solo cada vez que
enciendes la computadora.

**No necesitas saber programar ni tener nada instalado de antes.**

## 1. Descarga el instalador

Ve a la [página de versiones](https://github.com/Perlague/Drivesidian/releases)
y descarga `DrivesidianAgentSetup.exe` de la más reciente.

Pesa unos 30 MB porque trae Node.js incluido.

## 2. Ejecútalo y acepta la advertencia de Windows

Al abrirlo verás una pantalla azul que dice **"Windows protegió tu PC"**.

<!-- CAPTURA PENDIENTE: ejecutar el instalador y fotografiar la advertencia de
     SmartScreen, guardarla como docs/img/smartscreen.png y descomentar: -->
<!-- ![Advertencia de SmartScreen](img/smartscreen.png) -->

Haz clic en **Más información** y luego en **Ejecutar de todas formas**.

Esto sale porque el instalador **no está firmado digitalmente**: firmarlo
requiere comprar un certificado. La advertencia es correcta y no deberías
ignorarla a la ligera con cualquier programa — solo continúa si descargaste el
archivo del enlace de arriba.

## 3. Instala

Siguiente, siguiente, terminar. **No te va a preguntar nada**: ni contraseñas,
ni rutas, ni códigos.

Si no tenías Node.js, se instala solo. Si ya lo tenías, no se toca.

## 4. Vincula tu computadora

En cuanto termina la instalación, **se abre tu navegador solo** en una página
que dice "Vincular equipo".

Si es tu primera vez:

1. Crea una cuenta con tu correo y una contraseña.
2. Escanea el código QR con tu app de autenticación — Google Authenticator,
   Authy, Microsoft Authenticator, la que uses.
3. Escribe el código de seis dígitos que te muestra la app.
4. Verás el nombre de tu computadora y el vault que el agente encontró. Da clic
   en **Vincular este equipo**.

Si ya tenías cuenta, solo entra y aprueba.

## 5. Guarda una nota

Abre Obsidian. Dentro de tu vault hay ahora una carpeta llamada
**`Drivesidian`** — la creó el agente.

Todo lo que guardes ahí se sincroniza. Lo que esté fuera, no.

Escribe una nota, guárdala, y en unos minutos aparecerá en el panel web.

---

## Preguntas frecuentes

**¿Tengo que dejar Obsidian abierto?**
No. El agente es un programa aparte que vigila la carpeta en el disco.

**¿Cada cuánto se sincroniza?**
El servidor sube las notas pendientes cada pocos minutos, agrupadas. Si tienes
prisa, entra al panel y usa **Sincronizar ahora**.

**¿Puedo ver que está funcionando?**
En el panel, la lista de notas muestra cuáles están pendientes y cuáles ya
subieron.

**¿Y si edito una nota desde el panel web?**
El cambio baja a tu computadora en menos de un minuto. La sincronización va en
los dos sentidos: lo que escribes en Obsidian sube, y lo que escribes en el
panel baja.

**¿Y si edito la misma nota en los dos lados sin que se sincronice entre
medias?**
Nada se pierde. El agente detecta el choque, **no toca tu archivo local**, y la
nota aparece marcada como *en conflicto* en el panel. Ahí ves las dos versiones
y eliges con dos botones: quedarte con la del servidor o con la de tu
computadora. No las fusiona solo, porque juntar dos versiones de un texto no
produce algo que se entienda.

**¿Y si mi computadora estuvo apagada una semana?**
No pasa nada. El agente no acumula peticiones mientras está apagado: al
encender, pregunta una vez y se trae todo lo que se perdió.

**¿Qué pasa si borro una nota en Obsidian?**
Se queda en el servidor y en GitHub. Borrar notas no está implementado todavía.

**¿Quiero recibir avisos en el celular.**
Instala la app de [ntfy](https://ntfy.sh) y, en el panel, escanea el código QR
de la sección Notificaciones. Ese canal es tuyo: no lo compartas, porque
cualquiera que lo conozca puede leer tus avisos.

**Cambié de computadora.**
Instala el agente en la nueva y vincúlala igual. Tus notas están a salvo: viven
en el servidor y en GitHub, no en el agente.

**¿Cómo lo desinstalo?**
Desde *Agregar o quitar programas*, como cualquier otro. El desinstalador revoca
el acceso de ese equipo automáticamente. Node.js **no** se desinstala, por si lo
usas para otra cosa.

**Perdí el acceso de una computadora / me la robaron.**
Entra al panel, sección *Equipos vinculados*, y revoca su acceso. Deja de
sincronizar de inmediato.

---

## Si algo no funciona

El agente deja un registro en:

```
%APPDATA%\Drivesidian\agent.log
```

Pega esa ruta en el explorador de archivos para abrirlo. Las últimas líneas
suelen decir qué pasó.

**No se abrió el navegador al instalar.** Busca en el log la línea que dice
"Abriendo el navegador en:" y pega esa dirección a mano.

**El código de vinculación caducó.** Dura 10 minutos. Reinicia la computadora o
ejecuta el acceso directo del agente para que genere uno nuevo.

**Dice que el acceso fue revocado.** Alguien lo revocó desde el panel. Reinicia
el agente y se vuelve a vincular.

**No encontró mi vault.** Abre Obsidian al menos una vez y reinicia el agente:
el agente lee el registro de vaults que Obsidian mantiene, y ese archivo no
existe hasta que lo abres.
