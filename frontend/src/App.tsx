import { useEffect, useState, type FormEvent } from 'react'

type Status = { api: string; database: string; pgvector: boolean; ollama_model: string; ollama: string }
type Analysis = {
  resume_skills: string[]; job_skills: string[]; matched_skills: string[];
  missing_skills: string[]; skill_match_percent: number | null;
  resume_word_count: number; note: string
}
const API = import.meta.env.VITE_API_URL || 'http://localhost:8002'

export default function App() {
  const [status, setStatus] = useState<Status | null>(null)
  const [statusError, setStatusError] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [jobDescription, setJobDescription] = useState('')
  const [result, setResult] = useState<Analysis | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const [aiResult, setAiResult] = useState<{feedback: {summary: string; strengths: string[]; improvements: string[]; suggested_bullets: string[]}; model: string} | null>(null)

  useEffect(() => {
    fetch(`${API}/api/v1/status`)
      .then(async r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(setStatus).catch(e => setStatusError(String(e)))
  }, [])

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!file || !jobDescription.trim()) return
    setError(''); setResult(null); setLoading(true)
    const form = new FormData()
    form.append('resume', file)
    form.append('job_description', jobDescription)
    try {
      const response = await fetch(`${API}/api/v1/resume/analyze`, { method: 'POST', body: form })
      const data = await response.json()
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Analysis failed')
      setResult(data as Analysis)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally { setLoading(false) }
  }

  async function requestAiFeedback() {
    if (!file || !jobDescription.trim()) return
    setAiLoading(true); setAiError(''); setAiResult(null)
    const form = new FormData()
    form.append('resume', file)
    form.append('job_description', jobDescription)
    try {
      const response = await fetch(`${API}/api/v1/resume/ai-feedback`, {method: 'POST', body: form})
      const data = await response.json()
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'AI analysis failed')
      setAiResult(data)
    } catch (err) { setAiError(err instanceof Error ? err.message : 'AI analysis failed') }
    finally { setAiLoading(false) }
  }

  return <main>
    <div className="eyebrow">CAREERPILOT AI · PHASE 3</div>
    <h1>Understand your resume. Find your next opportunity.</h1>
    <p className="lead">Upload a PDF resume and compare its technical skills with a job description.</p>
    <section>
      <h2>Resume skill match</h2>
      <form onSubmit={submit}>
        <label htmlFor="resume">Resume (PDF, up to 5 MB)</label>
        <input id="resume" type="file" accept=".pdf,application/pdf" required onChange={e => setFile(e.target.files?.[0] ?? null)} />
        <label htmlFor="jd">Job description</label>
        <textarea id="jd" rows={9} maxLength={30000} required placeholder="Paste the job description here…" value={jobDescription} onChange={e => setJobDescription(e.target.value)} />
        <button disabled={loading || !file || !jobDescription.trim()}>{loading ? 'Analyzing…' : 'Analyze resume'}</button>
      </form>
      {error && <p role="alert" className="error">{error}</p>}
      {result && <div className="results" aria-live="polite">
        <div className="score">{result.skill_match_percent === null ? 'N/A' : `${result.skill_match_percent}%`}<small>Skill coverage</small></div>
        <p className="muted">{result.note}</p>
        <h3>Matching skills ({result.matched_skills.length})</h3>
        <div className="chips">{result.matched_skills.length ? result.matched_skills.map(s => <span className="chip match" key={s}>{s}</span>) : <p>No matching skills detected.</p>}</div>
        <h3>Skills mentioned in job description but not detected in resume ({result.missing_skills.length})</h3>
        <div className="chips">{result.missing_skills.length ? result.missing_skills.map(s => <span className="chip missing" key={s}>{s}</span>) : <p>None detected.</p>}</div>
        <h3>Other detected resume skills</h3>
        <div className="chips">{result.resume_skills.filter(s => !result.matched_skills.includes(s)).map(s => <span className="chip" key={s}>{s}</span>)}</div>
        <p className="muted">Extracted {result.resume_word_count} words from your resume. Files are processed in memory and are not saved by this feature.</p>
      </div>}
    </section>
    <section>
      <h2>AI career feedback (local Ollama)</h2>
      <p className="muted">Uses the PDF and job description entered above. Processing may take a few minutes on CPU.</p>
      <button type="button" disabled={!file || !jobDescription.trim() || aiLoading} onClick={requestAiFeedback}>{aiLoading ? 'Generating feedback…' : 'Generate AI feedback'}</button>
      {aiError && <p role="alert" className="error">{aiError}</p>}
      {aiResult && <div className="results" aria-live="polite">
        <p className="muted">Model: {aiResult.model} · AI output should be verified before using.</p>
        <h3>Summary</h3><p>{aiResult.feedback.summary}</p>
        <h3>Strengths</h3><ul>{aiResult.feedback.strengths.map((x,i) => <li key={i}>{x}</li>)}</ul>
        <h3>Areas to improve</h3><ul>{aiResult.feedback.improvements.map((x,i) => <li key={i}>{x}</li>)}</ul>
        <h3>Suggested bullet ideas (verify facts)</h3><ul>{aiResult.feedback.suggested_bullets.map((x,i) => <li key={i}>{x}</li>)}</ul>
      </div>}
    </section>
    <section><h2>System status</h2>{statusError ? <p className="error">Backend connection failed: {statusError}</p> : !status ? <p>Checking services…</p> : <div className="stats"><div><span>API</span><strong>{status.api}</strong></div><div><span>PostgreSQL</span><strong>{status.database}</strong></div><div><span>pgvector</span><strong>{status.pgvector ? 'enabled' : 'unavailable'}</strong></div><div><span>Local LLM</span><strong>{status.ollama_model}</strong><small>Connectivity: {status.ollama}</small></div></div>}</section>
    <p className="foot">Next: Ollama-powered resume suggestions, semantic job search, and agent workflows.</p>
  </main>
}
