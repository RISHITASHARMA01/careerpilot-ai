import DataExport from './DataExport'
import ApplicationAnalytics from './ApplicationAnalytics'
import InterviewDashboard from './InterviewDashboard'
import ApplicationTracker from './ApplicationTracker'
import ApplicationWorkspace from './ApplicationWorkspace'
import { useEffect, useState, type FormEvent } from 'react'

type Status = { api: string; database: string; pgvector: boolean; ollama_model: string; ollama: string }
type Analysis = {
  resume_skills: string[]; job_skills: string[]; matched_skills: string[];
  missing_skills: string[]; skill_match_percent: number | null;
  resume_word_count: number; note: string
}
const API = import.meta.env.VITE_API_URL || 'http://localhost:8002'

type DiscoveredJob = {
  id: string
  title: string
  company: string
  location: string | null
  source: string | null
  source_url: string | null
  published_at: string | null
}

function JobDiscoveryDashboard() {
  const [jobs, setJobs] = useState<DiscoveredJob[]>([])
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('all')
  const [level, setLevel] = useState('all')
  const [loadingJobs, setLoadingJobs] = useState(false)
  const [jobError, setJobError] = useState('')

  async function loadJobs() {
    setLoadingJobs(true)
    setJobError('')
    try {
      const response = await fetch(`${API}/api/v1/discovery/jobs?limit=100`)
      if (!response.ok) throw new Error(`Could not load jobs (HTTP ${response.status})`)
      const data: { jobs?: DiscoveredJob[] } = await response.json()
      if (!Array.isArray(data.jobs)) throw new Error('Unexpected discovery response')
      setJobs(data.jobs)
    } catch (err) {
      setJobError(err instanceof Error ? err.message : 'Could not load jobs')
    } finally {
      setLoadingJobs(false)
    }
  }

  useEffect(() => { void loadJobs() }, [])

  const filtered = jobs.filter(job => {
    const text = `${job.title} ${job.company} ${job.location || ''}`.toLowerCase()
    const title = job.title.toLowerCase()
    if (query && !text.includes(query.toLowerCase().trim())) return false
    if (source !== 'all' && job.source !== source) return false
    if (level === 'entry' && !/\b(intern|internship|junior|entry.level|graduate|trainee|fresher|associate)\b/i.test(title)) return false
    if (level === 'exclude-senior' && /\b(senior|sr\.?|lead|principal|staff|director|head|architect)\b/i.test(title)) return false
    return true
  })
  const sources = Array.from(new Set(jobs.map(job => job.source).filter((x): x is string => Boolean(x))))

  return <section id="job-discovery" className="discovery">
    <div className="discovery-heading">
      <div>
        <div className="eyebrow">PHASE 4D · LIVE IMPORTED JOBS</div>
        <h2>Discover opportunities</h2>
        <p className="muted">Browse jobs imported into your local database. Verify location and experience requirements on the employer's posting.</p>
      </div>
      <button type="button" onClick={() => void loadJobs()} disabled={loadingJobs}>
        {loadingJobs ? 'Loading…' : 'Refresh jobs'}
      </button>
    </div>
    <div className="discovery-filters">
      <div><label htmlFor="job-search">Search roles, companies, locations</label>
        <input id="job-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Python, backend, Bengaluru…" /></div>
      <div><label htmlFor="job-source">Source</label>
        <select id="job-source" value={source} onChange={e => setSource(e.target.value)}>
          <option value="all">All sources</option>
          {sources.map(s => <option key={s} value={s}>{s}</option>)}
        </select></div>
      <div><label htmlFor="job-level">Title-based experience filter</label>
        <select id="job-level" value={level} onChange={e => setLevel(e.target.value)}>
          <option value="all">All levels</option>
          <option value="entry">Explicitly entry-level</option>
          <option value="exclude-senior">Exclude senior titles</option>
        </select></div>
    </div>
    <p className="muted" aria-live="polite">Showing {filtered.length} of {jobs.length} imported jobs (up to 100 loaded).</p>
    {jobError && <p role="alert" className="error">{jobError}</p>}
    {!loadingJobs && !jobError && filtered.length === 0 && <p className="muted">No matching jobs. Try clearing the filters or importing more jobs.</p>}
    <div className="job-grid">
      {filtered.map(job => <article className="job-card" key={job.id}>
        <div className="job-card-top"><span className="source-tag">{job.source || 'Imported'}</span>
          {job.published_at && <span className="muted">{new Date(job.published_at).toLocaleDateString()}</span>}</div>
        <h3>{job.title}</h3>
        <p className="job-company">{job.company}</p>
        <p className="muted">Location: {job.location || 'Not specified'}</p>
        {job.source_url && /^https?:\/\//i.test(job.source_url)
          ? <a className="job-link" href={job.source_url} target="_blank" rel="noopener noreferrer">View original posting ↗</a>
          : <span className="muted">No application link available</span>}
      </article>)}
    </div>
  </section>
}

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


  const [recommendations, setRecommendations] = useState<any[] | null>(null)
  const [recommendError, setRecommendError] = useState('')
  const [recommendLoading, setRecommendLoading] = useState(false)
  async function requestRecommendations() {
    if (!file) return
    setRecommendLoading(true); setRecommendError(''); setRecommendations(null)
    const form = new FormData()
    form.append('resume', file); form.append('limit', '10')
    try {
      const response = await fetch(`${API}/api/v1/jobs/recommend`, {method: 'POST', body: form})
      const data = await response.json()
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Recommendation request failed')
      setRecommendations(data.results)
    } catch (err) { setRecommendError(err instanceof Error ? err.message : 'Request failed') }
    finally { setRecommendLoading(false) }
  }

  const [chatMessage, setChatMessage] = useState('')
  const [chatHistory, setChatHistory] = useState<{role: 'user' | 'assistant'; content: string}[]>([])
  const [chatBusy, setChatBusy] = useState(false)
  const [chatError, setChatError] = useState('')

  async function sendChat(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const message = chatMessage.trim()
    if (!message || chatBusy) return
    setChatBusy(true); setChatError('')
    const history = chatHistory.slice(-6)
    const form = new FormData()
    form.append('message', message)
    form.append('history', JSON.stringify(history))
    if (file) form.append('resume', file)
    try {
      const response = await fetch(`${API}/api/v1/chat`, {method: 'POST', body: form})
      const data = await response.json()
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Chat failed')
      setChatHistory(prev => [...prev, {role: 'user', content: message}, {role: 'assistant', content: data.answer}])
      setChatMessage('')
    } catch (err) { setChatError(err instanceof Error ? err.message : 'Chat failed') }
    finally { setChatBusy(false) }
  }

  return <main>
    <div className="eyebrow">CAREERPILOT AI · PHASE 4D</div>
    <h1>Understand your resume. Find your next opportunity.</h1>
    <p className="lead">Upload a PDF resume and compare its technical skills with a job description.</p>
    <JobDiscoveryDashboard />
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
    <section>
      <h2>Personalized job recommendations</h2>
      <p className="muted">Uses the resume PDF selected above and jobs indexed in your local database. Scores are estimates, not hiring probabilities.</p>
      <button type="button" disabled={!file || recommendLoading} onClick={requestRecommendations}>{recommendLoading ? 'Finding jobs…' : 'Recommend jobs from my resume'}</button>
      {recommendError && <p role="alert" className="error">{recommendError}</p>}
      {recommendations && <div className="results" aria-live="polite">
        <h3>{recommendations.length} recommended jobs</h3>
        {!recommendations.length && <p>No indexed jobs yet. Add jobs through the API first.</p>}
        {recommendations.map(job => <article key={job.id} style={{borderBottom:'1px solid #33415c',padding:'18px 0'}}>
          <h3>{job.title} — {job.company}</h3>
          <p className="muted">{job.location} · Ranking score: {job.match_score}% · Semantic similarity: {Math.round(job.semantic_similarity*100)}%</p>
          <p>Matched skills: {job.matched_skills.join(', ') || 'None detected'}</p>
          <p>Skills to develop: {job.missing_skills.join(', ') || 'None detected'}</p>
          {job.source_url && <a href={job.source_url} target="_blank" rel="noopener noreferrer">View job posting</a>}
        </article>)}
      </div>}
    </section>
    <section>
      <h2>Career assistant (Phase 3D)</h2>
      <p className="muted">Ask about your career, resume, and locally indexed jobs. Optionally select a PDF resume above to provide context. Conversations are kept in this browser session only.</p>
      <div className="results" aria-live="polite">
        {chatHistory.length === 0 && <p className="muted">Try: Which indexed jobs match my skills?</p>}
        {chatHistory.map((m, i) => <div key={i} style={{marginBottom: '1rem', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}><strong>{m.role === 'user' ? 'You' : 'CareerPilot'}</strong><p>{m.content}</p></div>)}
      </div>
      <form onSubmit={sendChat}>
        <label htmlFor="chat-message">Your question</label>
        <textarea id="chat-message" rows={3} maxLength={2000} value={chatMessage} onChange={e => setChatMessage(e.target.value)} placeholder="What jobs match my resume?" required />
        <button type="submit" disabled={chatBusy || !chatMessage.trim()}>{chatBusy ? 'Thinking…' : 'Ask CareerPilot'}</button>
        <button type="button" disabled={chatBusy || chatHistory.length === 0} onClick={() => setChatHistory([])}>Clear conversation</button>
      </form>
      {chatError && <p role="alert" className="error">{chatError}</p>}
    </section>
    <section><h2>System status</h2>{statusError ? <p className="error">Backend connection failed: {statusError}</p> : !status ? <p>Checking services…</p> : <div className="stats"><div><span>API</span><strong>{status.api}</strong></div><div><span>PostgreSQL</span><strong>{status.database}</strong></div><div><span>pgvector</span><strong>{status.pgvector ? 'enabled' : 'unavailable'}</strong></div><div><span>Local LLM</span><strong>{status.ollama_model}</strong><small>Connectivity: {status.ollama}</small></div></div>}</section>
    <p className="foot">Next: Ollama-powered resume suggestions, semantic job search, and agent workflows.</p>
    <ApplicationWorkspace apiUrl={API} />
    <ApplicationTracker apiUrl={API} />
    <InterviewDashboard apiUrl={API} />
    <ApplicationAnalytics apiUrl={API} />
    <DataExport apiUrl={API} />
  </main>
}
