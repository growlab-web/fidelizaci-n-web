# Practik Fidelidad

Sistema propio de tarjetas de sellos para Apple Wallet y Google Wallet. Un solo servidor atiende a todos tus negocios clientes.

## Qué incluye

| Pantalla | Dirección | Quién la usa |
|---|---|---|
| Registro del cliente | `/c/<negocio>` | El cliente escanea el QR del mostrador, pone nombre y celular y agrega la tarjeta a su Wallet |
| Tarjeta web | `/t/<código>` | Respaldo si el cliente no usa Wallet: muestra sus sellos y su QR |
| Escáner del dueño | `/admin` | El dueño, o quien lo reemplace, entra con usuario y contraseña, escanea el QR, da el sello, entrega premios y ve el QR para su cartel. Hecha en Astro |
| Panel Practik | `/panel` | Tú creas y editas negocios: nombre, colores, logo, número de sellos, premio, usuario y contraseña |

Cuando el dueño suma un sello, el servidor guarda el cambio y lo envía a la tarjeta del cliente:
- **iPhone:** avisa a Apple con una notificación push y el iPhone descarga la tarjeta nueva en segundos. El cliente ve "Tu tarjeta ahora tiene 7/10 sellos".
- **Android:** actualiza la tarjeta en Google. Cuando le faltan 2 sellos o la completa, el cliente recibe un aviso.

Otras protecciones incluidas: si alguien intenta sellar la misma tarjeta dos veces en menos de 30 segundos, se pide confirmación; se puede quitar un sello mal puesto; el ingreso se bloquea tras 6 intentos fallidos durante 10 minutos; cada celular tiene una sola tarjeta por negocio.

Si alguien reemplazó al dueño y ya no debe tener acceso, cambia la contraseña del negocio desde `/panel`: todas las sesiones abiertas se cierran al instante.

## Probarlo en tu computadora (5 minutos)

Necesitas Node.js 20 o más reciente.

```bash
npm install
npm run seed          # crea el negocio demo "Café Misti"
npm run build         # construye la pantalla del dueño (Astro)
ADMIN_KEY=demo123 npm start
```

En PowerShell (Windows) la última línea es `$env:ADMIN_KEY = 'demo123'; npm start`.

Abre:
- http://localhost:3000/c/cafe-misti para obtener una tarjeta como cliente
- http://localhost:3000/admin para sellar como dueño (usuario `cafe-misti`, contraseña `1234`)
- http://localhost:3000/panel para crear negocios (clave demo123)

Para trabajar en la pantalla del dueño con recarga automática, deja `npm start` corriendo y en otra terminal ejecuta `npm run dev:web`; ábrela en http://localhost:4321/admin.

Sin las credenciales de Apple y Google todo funciona con la tarjeta web; los botones de Wallet aparecen solos cuando configuras las cuentas.

## Abrirlo en Visual Studio Code con Claude Code

1. Descomprime la carpeta y ábrela en VS Code (Archivo → Abrir carpeta).
2. En la terminal integrada ejecuta `npm install`.
3. Abre Claude Code (extensión de VS Code o el comando `claude` en la terminal). El archivo `CLAUDE.md` le explica el proyecto, así que puedes pedirle cambios directamente.

## Publicarlo en Vercel

1. **Base de datos.** Vercel no guarda archivos, así que necesitas Postgres en la nube. Crea un proyecto en [Supabase](https://supabase.com) → Project Settings → Database → Connection string, y copia la del **pooler en modo transacción** (puerto 6543). También sirve [Neon](https://neon.tech). Las tablas se crean solas en la primera visita.
2. **Repositorio.** Sube la carpeta a GitHub:
   ```bash
   git init && git add . && git commit -m "Practik Fidelidad"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/practik-fidelidad.git
   git push -u origin main
   ```
   El `.gitignore` ya excluye `node_modules`, `data`, `dist`, `.env` y los certificados.
3. **Proyecto en Vercel.** En [vercel.com/new](https://vercel.com/new) importa el repositorio. No cambies nada de build: `vercel.json` ya indica todo.
4. **Variables de entorno.** En Settings → Environment Variables agrega las de `.env.example`: como mínimo `DATABASE_URL`, `PUBLIC_URL`, `SESSION_SECRET` y `ADMIN_KEY`. `PUBLIC_URL` es tu dominio con `https://` (ej. `https://fidelidad.practik.pe` o el `https://xxx.vercel.app` que te da Vercel). Después de agregar variables, vuelve a desplegar desde Deployments.
5. **Negocio demo (opcional).** En tu computadora, con la misma `DATABASE_URL` en `.env`, ejecuta `npm run seed`. O crea los negocios desde `/panel`.
6. **Dominio.** En Settings → Domains agrega tu subdominio y actualiza `PUBLIC_URL`. Haz esto antes de entregar tarjetas reales: el dominio queda grabado en cada pase de Apple y cambiarlo después rompe sus actualizaciones.

Revisa `https://tu-dominio/health`: debe responder `"apple": true, "google": true` cuando todo esté listo.

Cada vez que hagas `git push`, Vercel publica la nueva versión sola.

## Apple Wallet

Costo: membresía Apple Developer, USD 99 al año. Con una sola cuenta emites tarjetas para todos tus negocios.

1. Inscríbete en el [Apple Developer Program](https://developer.apple.com/programs/). Como persona natural es inmediato; como empresa Apple pide número D-U-N-S y tarda más.
2. Anota tu **Team ID** (Membership → Team ID) → `APPLE_TEAM_ID`.
3. Ve a Certificates, Identifiers & Profiles → Identifiers → **+** → **Pass Type IDs**. Crea uno como `pass.pe.practik.fidelidad` → `APPLE_PASS_TYPE_ID`.
4. Genera la llave y la solicitud de certificado en tu computadora:
   ```bash
   openssl req -new -newkey rsa:2048 -nodes -keyout signer.key -out signer.csr -subj "/CN=Practik Fidelidad"
   ```
5. En el Pass Type ID → **Create Certificate** → sube `signer.csr` → descarga `pass.cer` y conviértelo:
   ```bash
   openssl x509 -inform der -in pass.cer -out signer.pem
   ```
6. Descarga el certificado intermedio **Worldwide Developer Relations G4** desde [apple.com/certificateauthority](https://www.apple.com/certificateauthority/) y conviértelo:
   ```bash
   openssl x509 -inform der -in AppleWWDRCAG4.cer -out wwdr.pem
   ```
7. Pásalos a base64 y pégalos en las variables:
   ```bash
   base64 -w0 signer.pem   # APPLE_SIGNER_CERT_B64
   base64 -w0 signer.key   # APPLE_SIGNER_KEY_B64
   base64 -w0 wwdr.pem     # APPLE_WWDR_B64
   ```
   En Mac usa `base64 -i archivo` en lugar de `base64 -w0 archivo`.

El mismo certificado firma las tarjetas y envía las notificaciones de actualización. **Vence cada año:** pon un recordatorio para renovarlo, porque si vence las tarjetas dejan de actualizarse.

## Google Wallet

Costo: gratis.

1. Entra a la [Google Pay & Wallet Console](https://pay.google.com/business/console), crea el perfil de tu empresa y activa **Google Wallet API**. Copia tu **Issuer ID** → `GOOGLE_ISSUER_ID`.
2. En [Google Cloud Console](https://console.cloud.google.com) crea un proyecto, habilita **Google Wallet API**, crea una **cuenta de servicio** y descarga su llave en JSON.
3. En la Wallet Console → **Users**, invita el correo de la cuenta de servicio con acceso de desarrollador.
4. Convierte el JSON: `base64 -w0 cuenta.json` → `GOOGLE_SERVICE_ACCOUNT_B64`.
5. **Pide acceso de publicación** en la Wallet Console (Google Wallet API → Request publishing access). Mientras Google no lo apruebe, solo pueden guardar tarjetas las cuentas de Gmail que agregues como usuarios de prueba. Hazlo apenas tengas el servidor en línea, porque la revisión toma días.

## Antes de lanzar con clientes reales

- Reemplaza los botones "Agregar a Apple Wallet" y "Agregar a Google Wallet" por los distintivos oficiales que publican [Apple](https://developer.apple.com/wallet/add-to-apple-wallet-guidelines/) y [Google](https://developers.google.com/wallet/generic/resources/brand-guidelines). Ambas marcas exigen usarlos tal cual.
- Agrega a la página de registro un enlace a tu política de privacidad, porque guardas nombre y celular de los clientes.
- Prueba en un iPhone y un Android reales: agrega la tarjeta, sella desde el escáner y verifica que se actualice sola.

## Estructura

```
api/index.js           entrada para Vercel
vercel.json            configuración de Vercel
astro.config.mjs       configuración de Astro
web/pages/admin.astro  pantalla del dueño (Astro)
web/scripts/admin.js   lógica de la pantalla del dueño
views/                 páginas (registro, tarjeta web, panel)
public/                estilos y script compartidos
src/server.js          rutas: cliente, dueño, panel y web service de Apple
src/db.js              Postgres o base local, crea las tablas
src/images.js          logo, ícono y franja de sellos
src/wallet/apple.js    genera el .pkpass y envía las notificaciones push
src/wallet/google.js   clase por negocio, tarjeta por cliente, link de guardado
```
