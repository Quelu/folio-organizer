import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Card picture hosts refuse requests carrying an Origin header (Ravensburger) or send no CORS
// header (Lorcast): the proxy strips it so a deck image can draw them on a canvas
const imageProxy = (target, prefix) => ({
  target,
  changeOrigin: true,
  rewrite: (path) => path.replace(prefix, ''),
  configure: (proxy) => proxy.on('proxyReq', (proxyReq) => proxyReq.removeHeader('origin')),
})

// Cardmarket's public price files and LorcanaJSON's card files send no CORS header:
// the browser fetches them through this proxy
const proxy = {
  '/card-images/lorcast': imageProxy('https://cards.lorcast.io', /^\/card-images\/lorcast/),
  '/card-images/ravensburger': imageProxy('https://api.lorcana.ravensburger.com', /^\/card-images\/ravensburger/),
  '/cardmarket': {
    target: 'https://downloads.s3.cardmarket.com',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/cardmarket/, ''),
  },
  '/lorcanajson': {
    target: 'https://lorcanajson.org',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/lorcanajson/, ''),
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
})
