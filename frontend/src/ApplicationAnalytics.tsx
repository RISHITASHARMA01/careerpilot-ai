import { useCallback, useEffect, useState } from 'react'

type Application = {
  id: string
  company: string
  job_title: string
  status: string
  created_at: string
}

type HistoryEvent = {
  new_status: string
  changed_at: string
}

const STATUSES = [
  'draft', 'approved', 'applied', 'interview',
  'offer', 'rejected', 'withdrawn'
]

export default function ApplicationAnalytics({ apiUrl }: { apiUrl: string }) {
  const [apps, setApps] = useState<Application[]>([])
  const [history, setHistory] = useState<Record<string, HistoryEvent[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const response = await fetch(`${apiUrl}/api/v1/applications`)
      if (!response.ok) throw new Error(`Applications HTTP ${response.status}`)

      const data = await response.json()
      if (!Array.isArray(data.applications)) {
        throw new Error('Invalid applications response')
      }

      const applications: Application[] = data.applications
      setApps(applications)

      const results = await Promise.all(
        applications.map(async app => {
          const res = await fetch(
            `${apiUrl}/api/v1/applications/${app.id}/history`
          )
          if (!res.ok) throw new Error(`History HTTP ${res.status}`)
          const result = await res.json()
          return [app.id, result.history ?? []] as const
        })
      )

      setHistory(Object.fromEntries(results))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analytics unavailable')
    } finally {
      setLoading(false)
    }
  }, [apiUrl])

  useEffect(() => {
    void load()
  }, [load])

  const count = (status: string) =>
    apps.filter(app => app.status === status).length

  const everReached = (app: Application, status: string) =>
    app.status === status ||
    (history[app.id] ?? []).some(event => event.new_status === status)

  const submitted = apps.filter(app =>
    ['applied', 'interview', 'offer', 'rejected'].includes(app.status) ||
    everReached(app, 'applied')
  )

  const interviewed = submitted.filter(app =>
    everReached(app, 'interview')
  )

  const offers = submitted.filter(app =>
    everReached(app, 'offer')
  )

  const percent = (part: number, total: number) =>
    total ? `${((part / total) * 100).toFixed(1)}%` : 'N/A'

  const monthly = new Map<string, number>()

  for (const app of apps) {
    const date = new Date(app.created_at)
    if (Number.isNaN(date.getTime())) continue

    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    monthly.set(key, (monthly.get(key) ?? 0) + 1)
  }

  const months = [...monthly.entries()].sort(([a], [b]) => a.localeCompare(b))
  const maxMonth = Math.max(1, ...months.map(([, value]) => value))

  return (
    <section id="application-analytics" className="application-analytics">
      <div className="analytics-header">
        <div>
          <p className="muted">PHASE 6D · CAREER INSIGHTS</p>
          <h2>Application Analytics</h2>
          <p className="muted">
            Insights based on your saved application records.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh analytics'}
        </button>
      </div>

      {error && <p role="alert" className="error">{error}</p>}

      <div className="analytics-stats">
        {[
          ['Total applications', apps.length],
          ['Submitted / applied', submitted.length],
          ['Reached interview', interviewed.length],
          ['Offers received', offers.length]
        ].map(([label, value]) => (
          <div className="analytics-stat" key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <div className="analytics-stats">
        <div className="analytics-stat">
          <strong>{percent(interviewed.length, submitted.length)}</strong>
          <span>Interview conversion</span>
        </div>
        <div className="analytics-stat">
          <strong>{percent(offers.length, submitted.length)}</strong>
          <span>Offer conversion</span>
        </div>
      </div>

      <div className="analytics-panel">
        <h3>Current application status</h3>
        {STATUSES.map(status => {
          const value = count(status)
          return (
            <div className="analytics-bar-row" key={status}>
              <span>{status}</span>
              <div className="analytics-track">
                <div
                  className="analytics-fill"
                  style={{ width: `${apps.length ? value / apps.length * 100 : 0}%` }}
                />
              </div>
              <strong>{value}</strong>
            </div>
          )
        })}
      </div>

      <div className="analytics-panel">
        <h3>Applications created by month</h3>
        {months.length === 0 && <p className="muted">No application data yet.</p>}
        {months.map(([month, value]) => (
          <div className="analytics-bar-row" key={month}>
            <span>{month}</span>
            <div className="analytics-track">
              <div
                className="analytics-fill"
                style={{ width: `${value / maxMonth * 100}%` }}
              />
            </div>
            <strong>{value}</strong>
          </div>
        ))}
      </div>

      <p className="muted">
        Conversion rates use recorded status history and current statuses.
        Historical events from before tracking was enabled may be missing.
        Monthly activity counts newly created records, not submissions.
        Results include up to 100 applications returned by the API.
        Test applications are included.
      </p>
    </section>
  )
}
