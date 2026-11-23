import { useCallback, useEffect, useState, type FormEvent } from 'react'

type Application = {
  id: string
  company: string
  job_title: string
  status: string
}

type Interview = {
  id: string
  application_id: string
  company: string
  job_title: string
  interview_type: string
  scheduled_at: string
  duration_minutes: number
  meeting_link: string
  notes: string
  status: string
}

type InterviewStatus = 'scheduled' | 'completed' | 'cancelled'

const dateLabel = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  })

async function readResponse(response: Response) {
  const data = await response.json()
  if (!response.ok) {
    throw new Error(
      typeof data.detail === 'string'
        ? data.detail
        : `Request failed: HTTP ${response.status}`
    )
  }
  return data
}

export default function InterviewDashboard({
  apiUrl
}: {
  apiUrl: string
}) {
  const [interviews, setInterviews] = useState<Interview[]>([])
  const [applications, setApplications] = useState<Application[]>([])
  const [applicationId, setApplicationId] = useState('')
  const [interviewType, setInterviewType] = useState('technical')
  const [scheduledAt, setScheduledAt] = useState('')
  const [duration, setDuration] = useState(60)
  const [meetingLink, setMeetingLink] = useState('')
  const [notes, setNotes] = useState('')
  const [editingNotes, setEditingNotes] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [interviewData, applicationData] = await Promise.all([
        fetch(`${apiUrl}/api/v1/interviews`).then(readResponse),
        fetch(`${apiUrl}/api/v1/applications`).then(readResponse)
      ])
      setInterviews(interviewData.interviews ?? [])
      setApplications(applicationData.applications ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load interviews')
    } finally {
      setLoading(false)
    }
  }, [apiUrl])

  useEffect(() => {
    void load()
  }, [load])

  async function schedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')

    const localDate = new Date(scheduledAt)

    if (!scheduledAt || Number.isNaN(localDate.getTime())) {
      setError('Select a valid interview date and time.')
      return
    }
    if (localDate.getTime() <= Date.now()) {
      setError('Choose a future interview date.')
      return
    }

    setBusy(true)
    try {
      await fetch(`${apiUrl}/api/v1/interviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          application_id: applicationId,
          interview_type: interviewType,
          scheduled_at: localDate.toISOString(),
          duration_minutes: duration,
          meeting_link: meetingLink,
          notes
        })
      }).then(readResponse)

      setMessage('Interview saved successfully.')
      setScheduledAt('')
      setMeetingLink('')
      setNotes('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scheduling failed')
    } finally {
      setBusy(false)
    }
  }

  async function updateInterview(
    interview: Interview,
    status: InterviewStatus
  ) {
    if (!window.confirm(
      `Mark the ${interview.company} interview as ${status}?`
    )) return

    setBusy(true)
    setError('')
    setMessage('')

    try {
      await fetch(`${apiUrl}/api/v1/interviews/${interview.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          notes: editingNotes[interview.id] ?? interview.notes
        })
      }).then(readResponse)

      setMessage(`${interview.company}: interview updated.`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  const now = Date.now()
  const day = 24 * 60 * 60 * 1000

  const upcoming = interviews.filter(i =>
    i.status === 'scheduled' &&
    new Date(i.scheduled_at).getTime() > now
  )

  const next24Hours = upcoming.filter(i =>
    new Date(i.scheduled_at).getTime() - now <= day
  )

  const overdue = interviews.filter(i =>
    i.status === 'scheduled' &&
    new Date(i.scheduled_at).getTime() <= now
  )

  const filtered = interviews.filter(i =>
    filter === 'all' || i.status === filter
  )

  const eligibleApplications = applications.filter(a =>
    a.status === 'applied' || a.status === 'interview'
  )

  return (
    <section id="interview-dashboard" className="interview-dashboard">
      <div className="interview-heading">
        <div>
          <p className="muted">PHASE 6C · INTERVIEW MANAGEMENT</p>
          <h2>Interview Dashboard</h2>
          <p className="muted">
            Schedule interviews, prepare notes and track outcomes.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div className="interview-stats">
        <div><strong>{upcoming.length}</strong><span>Upcoming</span></div>
        <div><strong>{next24Hours.length}</strong><span>Within 24 hours</span></div>
        <div><strong>{interviews.filter(i => i.status === 'completed').length}</strong><span>Completed</span></div>
        <div><strong>{overdue.length}</strong><span>Past due</span></div>
      </div>

      {next24Hours.length > 0 && (
        <div className="interview-alert" role="status">
          <strong>Upcoming interview reminder</strong>
          {next24Hours.map(i => (
            <p key={i.id}>
              {i.company} — {dateLabel(i.scheduled_at)}
            </p>
          ))}
        </div>
      )}

      {overdue.length > 0 && (
        <p className="muted" role="status">
          {overdue.length} scheduled interview(s) have passed.
          Review and update their status.
        </p>
      )}

      {error && <p className="error" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}

      <div className="interview-panel">
        <h3>Schedule an interview</h3>
        <form onSubmit={schedule} className="interview-form">
          <div>
            <label htmlFor="interview-app">Application</label>
            <select
              id="interview-app"
              required
              value={applicationId}
              onChange={e => setApplicationId(e.target.value)}
            >
              <option value="">Select application</option>
              {eligibleApplications.map(a => (
                <option value={a.id} key={a.id}>
                  {a.company} — {a.job_title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="interview-type">Interview type</label>
            <select
              id="interview-type"
              value={interviewType}
              onChange={e => setInterviewType(e.target.value)}
            >
              {['hr', 'technical', 'coding', 'managerial', 'other'].map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="interview-date">Date and time</label>
            <input
              id="interview-date"
              type="datetime-local"
              required
              value={scheduledAt}
              onChange={e => setScheduledAt(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="interview-duration">Duration (minutes)</label>
            <input
              id="interview-duration"
              type="number"
              min={15}
              max={480}
              required
              value={duration}
              onChange={e => setDuration(Number(e.target.value))}
            />
          </div>

          <div>
            <label htmlFor="interview-link">Meeting link (optional)</label>
            <input
              id="interview-link"
              type="url"
              maxLength={2000}
              placeholder="https://..."
              value={meetingLink}
              onChange={e => setMeetingLink(e.target.value)}
            />
          </div>

          <div className="interview-wide">
            <label htmlFor="interview-notes">Preparation notes</label>
            <textarea
              id="interview-notes"
              rows={3}
              maxLength={5000}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Topics to revise, questions to ask..."
            />
          </div>

          <button
            type="submit"
            disabled={busy || !applicationId || !scheduledAt}
          >
            {busy ? 'Saving...' : 'Schedule interview'}
          </button>
        </form>
        <p className="muted">
          This saves a local record. No calendar invitation or notification
          is sent.
        </p>
      </div>

      <div className="interview-panel">
        <div className="interview-heading">
          <h3>My interviews</h3>
          <select
            aria-label="Filter interviews by status"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          >
            <option value="all">All interviews</option>
            <option value="scheduled">Scheduled</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        <div className="interview-list">
          {filtered.map(i => (
            <article className="interview-card" key={i.id}>
              <div className="interview-heading">
                <div>
                  <h4>{i.company}</h4>
                  <p>{i.job_title}</p>
                </div>
                <span className="tracker-badge">{i.status}</span>
              </div>

              <p>
                <strong>{i.interview_type.toUpperCase()}</strong>
                {' · '}
                {dateLabel(i.scheduled_at)}
                {' · '}
                {i.duration_minutes} minutes
              </p>

              {i.meeting_link && /^https?:\/\//i.test(i.meeting_link) && (
                <p>
                  <a
                    href={i.meeting_link}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open meeting link
                  </a>
                </p>
              )}

              <label htmlFor={`notes-${i.id}`}>Notes and feedback</label>
              <textarea
                id={`notes-${i.id}`}
                rows={3}
                maxLength={5000}
                value={editingNotes[i.id] ?? i.notes}
                onChange={e => setEditingNotes(prev => ({
                  ...prev,
                  [i.id]: e.target.value
                }))}
              />

              <div className="interview-buttons">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void updateInterview(
                    i, i.status as InterviewStatus
                  )}
                >
                  Save notes
                </button>

                {i.status === 'scheduled' && (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void updateInterview(i, 'completed')}
                    >
                      Mark completed
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void updateInterview(i, 'cancelled')}
                    >
                      Cancel interview
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}

          {!loading && filtered.length === 0 && (
            <p className="muted">No interviews found.</p>
          )}
        </div>
      </div>
    </section>
  )
}
