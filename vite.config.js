import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import svgLoader from 'vite-svg-loader';

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  publicDir: 'static',
  plugins: [
    vue(),
    svgLoader()
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: 'dist/app',
    sourcemap: true,
    commonjsOptions: { include: [/source-map-js/] },
  },
  preview: {
    port: 8081,
    proxy: {
      // string shorthand
      '/api/room': 'http://localhost:3000',
      '/api': 'https://www.netquake.io'
    }
  },
  server: {
    port: 8081,
    host: '0.0.0.0',
    proxy: {
      // string shorthand
      '/api/room': 'http://localhost:3000',
      '/api/player': 'http://localhost:3000',
      '/api': 'https://www.netquake.io',
      '/mapthumbs': 'https://servers.quakeone.com',
      // with RegEx
      '^/fallback/.*': {
        target: 'http://jsonplaceholder.typicode.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/fallback/, '')
      },
    }
  }
})