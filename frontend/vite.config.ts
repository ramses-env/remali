import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import type { ProxyOptions } from 'vite'

/** Envuelve una configuración de proxy Vite para silenciar los errores benignos
 *  `write EPIPE` y `read ECONNRESET` que aparecen cuando el backend Django se
 *  cae, se reinicia o no está levantado. Estos errores NO afectan al usuario
 *  (son solo intentos de Vite de escribir en un socket cerrado) pero llenan la
 *  consola con docenas de stack traces irrelevantes. */
function proxySinRuido(opts: ProxyOptions): ProxyOptions {
  return {
    ...opts,
    configure: (proxy) => {
      proxy.on('error', () => {})
      if (typeof opts.configure === 'function') opts.configure(proxy, opts)
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'production' ? '/static/' : '/',
  build: {
    rollupOptions: {
      output: {
        /* Sin esto, las librerías grandes se copian dentro del chunk de la primera
           ruta que las toca, y cambiar una línea de esa ruta obliga al navegador a
           volver a bajarlas. Separadas, se cachean una vez y sobreviven a los
           despliegues. `react-vendor` va aparte porque lo necesita cualquier ruta;
           las demás solo bajan cuando la pantalla que las usa se abre. */
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          motion: ['framer-motion'],
          iconos: ['lucide-react'],
          codigos: ['qrcode', 'jsbarcode'],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    // Permite abrir el sitio a través de un túnel público (cloudflared/localtunnel)
    // para pruebas. Vite bloquea hosts desconocidos por defecto.
    allowedHosts: true,
    proxy: {
      // WebSocket de notificaciones en tiempo real (Channels).
      '/ws': proxySinRuido({
        target: 'ws://localhost:8000',
        ws: true,
        changeOrigin: true,
      }),
      '/api': proxySinRuido({
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      }),
      '/admin': proxySinRuido({
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      }),
      '/static': proxySinRuido({
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      }),
      '/media': proxySinRuido({
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      }),
    },
  },
}))
