import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Cardmarket's public price files and LorcanaJSON's card files send no CORS header:
// the browser fetches them through this proxy
const proxy = {
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
