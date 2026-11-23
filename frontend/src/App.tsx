import { useEffect, useState } from 'react'
type Status = { api: string; database: string; pgvector: boolean; ollama_model: string; ollama: string }
const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'
export default function App() {
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    fetch(`${API}/api/v1/status`)
      .then(async r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(setStatus)
      .catch(e => setError(String(e)))
  }, [])
  return <main><div className="eyebrow">CAREERPILOT AI · PHASE 1</div><h1>Your career, intelligently navigated.</h1><p className="lead">Local-first agentic job search and recommendation platform.</p><section><h2>System status</h2>{error ? <p className="error">Backend connection failed: {error}</p> : !status ? <p>Checking services…</p> : <div className="stats"><div><span>API</span><strong>{status.api}</strong></div><div><span>PostgreSQL</span><strong>{status.database}</strong></div><div><span>pgvector</span><strong>{status.pgvector ? 'enabled' : 'unavailable'}</strong></div><div><span>Local LLM</span><strong>{status.ollama_model}</strong><small>Connectivity: {status.ollama}</small></div></div>}</section><p className="foot">Resume analysis, semantic job search, and AI agent workflows are coming in the next phases.</p></main>
}
