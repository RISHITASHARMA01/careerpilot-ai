import { useCallback, useEffect, useState } from 'react'

type Application = {
  id: string
  company: string
  job_title: string
  job_url: string
  cover_letter: string
  question_answers: string
  status: string
  created_at: string
}

type Props = { apiUrl?: string }

const defaultApi = 'http://localhost:8002'

export default function ApplicationWorkspace({ apiUrl = defaultApi }: Props) {
  const [resume, setResume] = useState<File | null>(null)
  const [company, setCompany] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [jobUrl, setJobUrl] = useState('')
  const [description, setDescription] = useState('')
  const [question, setQuestion] = useState('Why should we hire you?')
  const [tone, setTone] = useState('professional')
  const [subject, setSubject] = useState('')
  const [coverLetter, setCoverLetter] = useState('')
  const [answer, setAnswer] = useState('')
  const [reviewNotes, setReviewNotes] = useState<string[]>([])
  const [missingInfo, setMissingInfo] = useState<string[]>([])
  const [applications, setApplications] = useState<Application[]>([])
  const [activeId, setActiveId] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reviewed, setReviewed] = useState(false)

  const loadApplications = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/v1/applications`)
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.detail || `HTTP ${response.status}`)
      setApplications(payload.applications || [])
    } catch (err) {
      setError(String(err))
    }
  }, [apiUrl])

  useEffect(() => { void loadApplications() }, [loadApplications])

  async function request(path: string, form: FormData) {
    setBusy(path)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`${apiUrl}/api/v1/agent/${path}`, { method: 'POST', body: form })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.detail || `HTTP ${response.status}`)
      return payload
    } catch (err) {
      setError(String(err))
      return null
    } finally {
      setBusy('')
    }
  }

  function baseForm() {
    if (!resume) { setError('Choose a PDF resume first.'); return null }
    if (description.trim().length < 30) { setError('Enter a job description (at least 30 characters).'); return null }
    const form = new FormData()
    form.append('resume', resume)
    form.append('job_description', description)
    form.append('company', company || 'Hiring Company')
    return form
  }

  async function generateCoverLetter() {
    const form = baseForm()
    if (!form) return
    form.append('tone', tone)
    const payload = await request('generate-cover-letter', form)
    if (payload) {
      setSubject(payload.subject || '')
      setCoverLetter(payload.cover_letter || '')
      setReviewNotes(payload.review_notes || [])
      setReviewed(false)
      setActiveId('')
      setNotice('Cover letter generated. Verify every claim before approval.')
    }
  }

  async function generateAnswer() {
    const form = baseForm()
    if (!form) return
    if (question.trim().length < 5) { setError('Enter an application question.'); return }
    form.append('question', question)
    const payload = await request('answer-question', form)
    if (payload) {
      setAnswer(payload.answer || '')
      setMissingInfo(payload.missing_information || [])
      setReviewed(false)
      setActiveId('')
      setNotice('Answer generated. Review and edit before approval.')
    }
  }

  async function persist(mode: 'create' | 'edit') {
    if (!company.trim() || !jobTitle.trim()) { setError('Company and job title are required.'); return }
    if (!coverLetter.trim() && !answer.trim()) { setError('Add a cover letter or application answer first.'); return }
    setBusy('save')
    setError('')
    setNotice('')
    try {
      const editing = mode === 'edit' && activeId
      const url = editing ? `${apiUrl}/api/v1/applications/${activeId}` : `${apiUrl}/api/v1/applications`
      const body = editing
        ? { cover_letter: coverLetter, question_answers: answer }
        : { company, job_title: jobTitle, job_url: jobUrl, cover_letter: coverLetter, question_answers: answer }
      const response = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.detail || `HTTP ${response.status}`)
      if (!editing) setActiveId(payload.id)
      setReviewed(false)
      setNotice('Draft saved. Approval is still required.')
      await loadApplications()
    } catch (err) { setError(String(err)) }
    finally { setBusy('') }
  }

  async function approve() {
    if (!activeId || !reviewed) { setError('Save the draft and confirm factual review first.'); return }
    setBusy('approve')
    setError('')
    try {
      const response = await fetch(`${apiUrl}/api/v1/applications/${activeId}/approve`, { method: 'POST' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.detail || `HTTP ${response.status}`)
      setNotice('Approved for manual submission. Nothing was submitted externally.')
      setReviewed(false)
      await loadApplications()
    } catch (err) { setError(String(err)) }
    finally { setBusy('') }
  }

  function openDraft(item: Application) {
    setActiveId(item.id)
    setCompany(item.company)
    setJobTitle(item.job_title)
    setJobUrl(item.job_url)
    setCoverLetter(item.cover_letter)
    setAnswer(item.question_answers)
    setReviewed(false)
    setReviewNotes([])
    setMissingInfo([])
    setError('')
    setNotice(`Loaded ${item.status} application. Edits require saving and fresh approval.`)
  }

  const selected = applications.find(a => a.id === activeId)
  const fieldStyle = { width: '100%', padding: '12px', marginTop: '6px', marginBottom: '14px' }
  const buttonStyle = { marginRight: '10px', marginBottom: '10px' }

  return (
    <section id="application-workspace">
      <h2>AI Application Workspace</h2>
      <p className="muted">Generate, edit, save and approve application drafts. Approval never submits an application.</p>
      <label>Resume PDF</label>
      <input type="file" accept="application/pdf,.pdf" onChange={e => setResume(e.target.files?.[0] || null)} style={fieldStyle} />
      <label>Company</label>
      <input value={company} onChange={e => setCompany(e.target.value)} placeholder="Company name" style={fieldStyle} />
      <label>Job title</label>
      <input value={jobTitle} onChange={e => setJobTitle(e.target.value)} placeholder="Software Development Intern" style={fieldStyle} />
      <label>Job posting URL (optional)</label>
      <input value={jobUrl} onChange={e => setJobUrl(e.target.value)} placeholder="https://..." style={fieldStyle} />
      <label>Job description</label>
      <textarea value={description} onChange={e => setDescription(e.target.value)} rows={6} placeholder="Paste the job description" style={fieldStyle} />
      <label>Cover letter tone</label>
      <select value={tone} onChange={e => setTone(e.target.value)} style={fieldStyle}>
        <option value="professional">Professional</option>
        <option value="confident">Confident</option>
        <option value="concise">Concise</option>
      </select>
      <button type="button" disabled={!!busy} style={buttonStyle} onClick={generateCoverLetter}>
        {busy === 'generate-cover-letter' ? 'Generating…' : 'Generate cover letter'}
      </button>
      <label>Application question</label>
      <textarea value={question} onChange={e => setQuestion(e.target.value)} rows={2} style={fieldStyle} />
      <button type="button" disabled={!!busy} style={buttonStyle} onClick={generateAnswer}>
        {busy === 'answer-question' ? 'Generating…' : 'Generate answer'}
      </button>
      <h3>Review and edit</h3>
      {subject && <p><strong>Suggested subject:</strong> {subject}</p>}
      <label>Cover letter</label>
      <textarea value={coverLetter} onChange={e => { setCoverLetter(e.target.value); setReviewed(false) }} rows={12} style={fieldStyle} />
      <label>Application answer</label>
      <textarea value={answer} onChange={e => { setAnswer(e.target.value); setReviewed(false) }} rows={7} style={fieldStyle} />
      {reviewNotes.length > 0 && <div><h3>AI review notes (not independently verified)</h3><ul>{reviewNotes.map((note, i) => <li key={i}>{note}</li>)}</ul></div>}
      {missingInfo.length > 0 && <div><h3>Information to check</h3><ul>{missingInfo.map((note, i) => <li key={i}>{note}</li>)}</ul></div>}
      <button type="button" disabled={!!busy} style={buttonStyle} onClick={() => void persist(activeId ? 'edit' : 'create')}>
        {busy === 'save' ? 'Saving…' : activeId ? 'Save changes as draft' : 'Save new draft'}
      </button>
      {activeId && <button type="button" disabled={!!busy} style={buttonStyle} onClick={() => { setActiveId(''); setReviewed(false); setNotice('New draft mode. Existing saved drafts are unchanged.') }}>Start new application</button>}
      <p><label><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} style={{ width: 'auto', marginRight: 8 }} />I have checked all claims and reviewed the saved draft.</label></p>
      <button type="button" disabled={!!busy || !activeId || !reviewed || selected?.status !== 'draft'} onClick={approve}>
        {busy === 'approve' ? 'Approving…' : 'Approve saved draft'}
      </button>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <h3>Saved applications</h3>
      <button type="button" disabled={!!busy} style={buttonStyle} onClick={() => void loadApplications()}>Refresh list</button>
      {applications.length === 0 ? <p className="muted">No saved applications yet.</p> : (
        <div className="results">
          {applications.map(item => (
            <article key={item.id} style={{ padding: '14px 0', borderBottom: '1px solid #33415c' }}>
              <strong>{item.job_title}</strong> — {item.company}<br />
              <small>Status: {item.status}</small><br />
              <button type="button" disabled={!!busy} style={{ marginTop: 8 }} onClick={() => openDraft(item)}>Open draft</button>
              {item.job_url && <p><a href={item.job_url} target="_blank" rel="noopener noreferrer">Original job posting</a></p>}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
