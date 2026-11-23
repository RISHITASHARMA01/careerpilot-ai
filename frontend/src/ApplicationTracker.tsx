import { useCallback, useEffect, useState } from 'react'

type Application = {
  id: string
  company: string
  job_title: string
  job_url: string
  status: string
  created_at: string
  updated_at: string
}

type HistoryEvent = {
  id: string
  old_status: string
  new_status: string
  note: string
  changed_at: string
}

const STATUSES = [
  'draft', 'approved', 'applied', 'interview',
  'offer', 'rejected', 'withdrawn'
]

const TRANSITIONS: Record<string, string[]> = {
  draft: [],
  approved: ['applied', 'withdrawn'],
  applied: ['interview', 'offer', 'rejected', 'withdrawn'],
  interview: ['offer', 'rejected', 'withdrawn', 'applied'],
  offer: ['withdrawn', 'rejected'],
  rejected: [],
  withdrawn: []
}

const formatStatus = (status: string) =>
  status.charAt(0).toUpperCase() + status.slice(1)

const formatDate = (date: string) =>
  new Date(date).toLocaleString()

export default function ApplicationTracker({
  apiUrl
}: {
  apiUrl: string
}) {
  const [applications, setApplications] = useState<Application[]>([])
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [selectedStatus, setSelectedStatus] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [historyId, setHistoryId] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryEvent[]>([])

  const loadApplications = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const response = await fetch(`${apiUrl}/api/v1/applications`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const data = await response.json()
      setApplications(data.applications ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load applications')
    } finally {
      setLoading(false)
    }
  }, [apiUrl])

  useEffect(() => {
    void loadApplications()
  }, [loadApplications])

  async function updateStatus(application: Application) {
    const status = selectedStatus[application.id]
    if (!status) return

    const confirmed = window.confirm(
      `Change ${application.company} from ${application.status} to ${status}?\n\n` +
      'This only updates your local tracking record. It does not submit an application.'
    )

    if (!confirmed) return

    setBusyId(application.id)
    setError('')
    setMessage('')

    try {
      const response = await fetch(
        `${apiUrl}/api/v1/applications/${application.id}/status`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status,
            note: notes[application.id] ?? ''
          })
        }
      )

      const result = await response.json()

      if (!response.ok) {
        throw new Error(
          typeof result.detail === 'string'
            ? result.detail
            : `HTTP ${response.status}`
        )
      }

      setMessage(`${application.company}: status updated to ${status}.`)
      setSelectedStatus(prev => ({ ...prev, [application.id]: '' }))
      setNotes(prev => ({ ...prev, [application.id]: '' }))

      await loadApplications()

      if (historyId === application.id) {
        await viewHistory(application.id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status update failed')
    } finally {
      setBusyId(null)
    }
  }

  async function viewHistory(id: string) {
    if (historyId === id) {
      setHistoryId(null)
      setHistory([])
      return
    }

    setError('')

    try {
      const response = await fetch(
        `${apiUrl}/api/v1/applications/${id}/history`
      )

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const data = await response.json()
      setHistory(data.history ?? [])
      setHistoryId(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load history')
    }
  }

  const filtered = applications.filter(app => {
    const matchesStatus = filter === 'all' || app.status === filter
    const matchesSearch =
      `${app.company} ${app.job_title}`
        .toLowerCase()
        .includes(search.toLowerCase().trim())

    return matchesStatus && matchesSearch
  })

  const count = (status: string) =>
    applications.filter(app => app.status === status).length

  return (
    <section id="application-tracker" className="application-tracker">
      <div className="tracker-header">
        <div>
          <p className="muted">PHASE 6B · APPLICATION MANAGEMENT</p>
          <h2>Application Tracker</h2>
          <p className="muted">
            Track your applications and update their progress manually.
          </p>
        </div>
        <button type="button" onClick={() => void loadApplications()}>
          {loading ? 'Refreshing...' : 'Refresh applications'}
        </button>
      </div>

      <div className="tracker-stats">
        {[
          ['Total', applications.length],
          ['Applied', count('applied')],
          ['Interviews', count('interview')],
          ['Offers', count('offer')]
        ].map(([label, value]) => (
          <div className="tracker-stat" key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <div className="tracker-filters">
        <div>
          <label htmlFor="tracker-search">Search applications</label>
          <input
            id="tracker-search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Company or job title"
          />
        </div>
        <div>
          <label htmlFor="tracker-status">Filter by status</label>
          <select
            id="tracker-status"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          >
            <option value="all">All statuses</option>
            {STATUSES.map(status => (
              <option key={status} value={status}>
                {formatStatus(status)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}

      <p className="muted">
        Showing {filtered.length} of {applications.length} applications.
      </p>

      <div className="tracker-list">
        {filtered.map(app => (
          <article className="tracker-card" key={app.id}>
            <div className="tracker-card-header">
              <div>
                <h3>{app.company}</h3>
                <p>{app.job_title}</p>
              </div>
              <span className={`tracker-badge status-${app.status}`}>
                {formatStatus(app.status)}
              </span>
            </div>

            <p className="muted">
              Created: {formatDate(app.created_at)}
            </p>

            {app.job_url && /^https?:\/\//i.test(app.job_url) && (
              <a
                href={app.job_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                View job posting
              </a>
            )}

            {TRANSITIONS[app.status]?.length > 0 && (
              <div className="tracker-actions">
                <label htmlFor={`next-${app.id}`}>Update status</label>
                <select
                  id={`next-${app.id}`}
                  value={selectedStatus[app.id] ?? ''}
                  onChange={e => setSelectedStatus(prev => ({
                    ...prev,
                    [app.id]: e.target.value
                  }))}
                >
                  <option value="">Select next status</option>
                  {TRANSITIONS[app.status].map(status => (
                    <option value={status} key={status}>
                      {formatStatus(status)}
                    </option>
                  ))}
                </select>

                <label htmlFor={`note-${app.id}`}>Note (optional)</label>
                <textarea
                  id={`note-${app.id}`}
                  rows={2}
                  maxLength={1000}
                  value={notes[app.id] ?? ''}
                  onChange={e => setNotes(prev => ({
                    ...prev,
                    [app.id]: e.target.value
                  }))}
                  placeholder="e.g. Applied through company careers page"
                />

                <button
                  type="button"
                  disabled={!selectedStatus[app.id] || busyId === app.id}
                  onClick={() => void updateStatus(app)}
                >
                  {busyId === app.id ? 'Saving...' : 'Save status'}
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => void viewHistory(app.id)}
            >
              {historyId === app.id ? 'Hide history' : 'View history'}
            </button>

            {historyId === app.id && (
              <div className="tracker-history">
                <h4>Status history</h4>
                {history.length === 0 ? (
                  <p className="muted">No recorded status transitions yet.</p>
                ) : (
                  <ol>
                    {history.map(event => (
                      <li key={event.id}>
                        <strong>
                          {formatStatus(event.old_status)}
                          {' → '}
                          {formatStatus(event.new_status)}
                        </strong>
                        <p className="muted">{formatDate(event.changed_at)}</p>
                        {event.note && <p>{event.note}</p>}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </article>
        ))}

        {!loading && filtered.length === 0 && (
          <p className="muted">No matching applications found.</p>
        )}
      </div>
    </section>
  )
}
