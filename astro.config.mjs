// Astro construye solo la pantalla del dueño (/admin) como página estática en ./dist.
// Todo lo demás (API, Wallet, registro del cliente, panel) lo sigue atendiendo Express: src/server.js
import { defineConfig } from 'astro/config';

const API = 'http://localhost:3000';

export default defineConfig({
  srcDir: './web', // ./src ya es el servidor
  output: 'static',
  // En desarrollo (npm run dev:web) las llamadas al servidor se reenvían a Express
  // Ojo: "cookie" 2.x está en package.json a propósito. Express instala una versión antigua y,
  // si queda en la raíz de node_modules, "astro build" falla al generar la página.
  vite: { server: { proxy: { '/api': API, '/img': API, '/qr.svg': API } } },
});
