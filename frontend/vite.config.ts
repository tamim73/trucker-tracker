import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// MapLibre v6 loads its web worker relative to its own module, which breaks
// once the library is bundled. Serve the worker and its shared chunk from a
// fixed path instead and point MapLibre at it with setWorkerUrl().
const WORKER_FILES = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']
const workerSource = (file: string) =>
  readFileSync(fileURLToPath(new URL(`./node_modules/maplibre-gl/dist/${file}`, import.meta.url)))

function maplibreWorker(): Plugin {
  return {
    name: 'maplibre-worker',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = req.url?.startsWith('/maplibre/') ? req.url.slice('/maplibre/'.length).split('?')[0] : null
        if (!file || !WORKER_FILES.includes(file)) return next()
        res.setHeader('Content-Type', 'text/javascript')
        res.end(workerSource(file))
      })
    },
    generateBundle() {
      for (const file of WORKER_FILES) {
        this.emitFile({ type: 'asset', fileName: `maplibre/${file}`, source: workerSource(file) })
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), maplibreWorker()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  build: {
    chunkSizeWarningLimit: 1400,
  },
})
