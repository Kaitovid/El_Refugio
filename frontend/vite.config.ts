import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      // Proxea todas las llamadas REST al backend
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      // Proxea Socket.IO al backend
      '/socket.io': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        ws: true, // habilita WebSocket proxy
      },
      // Proxea archivos subidos
      '/uploads': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
})
