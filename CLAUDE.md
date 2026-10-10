# Practik Fidelidad

Sistema propio de tarjetas de sellos para Apple Wallet y Google Wallet, multi-negocio. Parte del proyecto Practik (agencia en Arequipa, Perú). El otro producto de Practik son tiendas catálogo que envían el pedido por WhatsApp.

Responde y escribe la interfaz en español (Perú). Los textos de la interfaz se dirigen al cliente con "tú".

## Cómo funciona

- El cliente escanea un QR en el mostrador → `/c/<slug>` → nombre y celular → botón "Agregar a Apple/Google Wallet". Respaldo: tarjeta web `/t/<código>`.
- El dueño (o quien lo reemplace) entra a `/admin` con usuario y contraseña, escanea el QR de la tarjeta (html5-qrcode), suma sellos, canjea premio. Esta pantalla está hecha en Astro y debe poder usarse sin explicación: un botón principal por paso y avisos grandes de lo que se acaba de hacer.
- Cada cambio llama a `syncWallets()`: push APNs vacío al iPhone (que luego pide el pase nuevo al web service `/apple/v1/...`) y PATCH del loyaltyObject en Google.
- `/panel` (header `x-admin-key` = `ADMIN_KEY`) crea y edita negocios, incluido el usuario y la contraseña del dueño.

## Estructura

- `web/` — Astro (`srcDir`, ver `astro.config.mjs`). Solo la pantalla del dueño: `web/pages/admin.astro` (pantallas y estilos) y `web/scripts/admin.js` (lógica). `astro build` la genera estática en `dist/`. Reutiliza `/app.css` y `/app.js`.
- `src/server.js` — Express 5. Rutas de páginas, API pública, API del dueño (`/api/admin/*`, sesión en la cookie `pk_owner`), web service de Apple, panel. Exporta `app`; solo hace `listen` si se ejecuta directo. En local también sirve `dist/`.
- `api/index.js` — entrada de Vercel. `vercel.json` construye Astro en `dist/` (lo sirve la CDN) y reescribe todo lo que no sea un archivo estático a `/api`; incluye `views/**` en la función.
- `src/db.js` — Postgres con `pg` si hay `DATABASE_URL`; si no, PGlite en `./data` (solo local). Crea las tablas al arrancar (no hay migraciones aún).
- `src/images.js` — logo, ícono y franja de sellos con sharp a partir de SVG.
- `src/wallet/apple.js` — `.pkpass` con passkit-generator (storeCard, strip con sellos, `changeMessage`), push APNs por HTTP/2 con el certificado del Pass Type ID.
- `src/wallet/google.js` — loyaltyClass por negocio (`<issuer>.practik_<slug>`), loyaltyObject por tarjeta (`<issuer>.card_<code>`), link de guardado firmado con JWT.
- `views/*.html` — páginas del cliente y el panel (las sirve la función). `public/app.css`, `public/app.js` — estáticos compartidos (en Vercel los sirve la CDN en `/app.css` y `/app.js`).

## Comandos

```bash
npm install
npm run seed                  # negocio demo: usuario cafe-misti, contraseña 1234
npm run build                 # construye /admin con Astro en ./dist
ADMIN_KEY=demo123 npm run dev # http://localhost:3000 (sirve también ./dist)
npm run dev:web               # Astro con recarga en http://localhost:4321/admin; necesita npm run dev en otra terminal
vercel dev                    # simula Vercel en local (necesita DATABASE_URL)
```

## Reglas y cuidados

- La contraseña del dueño se guarda en `businesses.pin_hash` (scrypt) y el usuario en `businesses.username`. Al cambiar la contraseña se cierran las sesiones abiertas: así el dueño le quita el acceso a un reemplazo.
- `cookie` 2.x está en `package.json` a propósito: sin eso queda en la raíz la versión antigua que trae Express y `astro build` falla.
- En Vercel es obligatorio `DATABASE_URL` (Supabase con el pooler en modo transacción, puerto 6543, o Neon).
- Los envíos a Apple/Google van dentro de `waitUntil` para que Vercel no congele la función antes de terminar.
- `PUBLIC_URL` debe ser https y coincidir con el dominio real: va dentro de cada pase de Apple (webServiceURL) y en las imágenes de Google.
- El límite de intentos de ingreso está en memoria; en Vercel no se comparte entre instancias. Si se necesita más seguridad, moverlo a la base de datos.
- Nunca subir certificados, llaves ni `.env` al repositorio.
- Pendientes conocidos: distintivos oficiales "Agregar a Apple/Google Wallet", política de privacidad en la página de registro, manifiesto para instalar el escáner del dueño en la pantalla de inicio, migraciones de base de datos.
