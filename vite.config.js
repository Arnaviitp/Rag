import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { loadServerEnv, proxyGroqRequest } from './server-utils.js'

loadServerEnv()

function apiMiddleware() {
  return {
    name: 'secure-groq-api',
    configureServer(server) {
      server.middlewares.use('/api/status', (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ groqConfigured: Boolean(process.env.GROQ_API_KEY) }))
      })

      server.middlewares.use('/api/groq', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        let rawBody = ''
        req.on('data', (chunk) => {
          rawBody += chunk
          if (rawBody.length > 2_000_000) req.destroy()
        })
        req.on('end', async () => {
          try {
            const result = await proxyGroqRequest(JSON.parse(rawBody || '{}'))
            res.statusCode = result.status
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(result.body))
          } catch (error) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: error.message }))
          }
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [apiMiddleware(), react(), tailwindcss()],
  server: {
    port: 3000,
    open: true
  }
})
