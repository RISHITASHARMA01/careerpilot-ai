import { useState } from 'react'

type Props = {
  apiUrl: string
}

function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value)

  // Prevent spreadsheet formula injection
  if (/^[\s]*[=+\-@\t\r]/.test(text)) {
    text = "'" + text
  }

  return `"${text.replace(/"/g, '""')}"`
}

function downloadCSV(
  filename: string,
  rows: Record<string, unknown>[],
  columns: string[]
) {
  const lines = [
    columns.map(csvCell).join(','),
    ...rows.map(row =>
      columns.map(column => csvCell(row[column])).join(',')
    )
  ]

  const blob = new Blob(
    ['\uFEFF' + lines.join('\r\n')],
    { type: 'text/csv;charset=utf-8;' }
  )

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()

  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function DataExport({ apiUrl }: Props) {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function exportData(
    endpoint: string,
    key: string,
    filename: string,
    columns: string[]
  ) {
    setBusy(key)
    setError('')
    setMessage('')

    try {
      const response = await fetch(`${apiUrl}${endpoint}`)

      if (!response.ok) {
        throw new Error(`Export failed: HTTP ${response.status}`)
      }

      const data = await response.json()
      const rows = data[key]

      if (!Array.isArray(rows)) {
        throw new Error('Unexpected API response')
      }

      downloadCSV(filename, rows, columns)

      setMessage(`Exported ${rows.length} ${key} records.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setBusy('')
    }
  }

  return (
    <section id="data-export">
      <h2>Export CareerPilot Data</h2>
      <p className="muted">
        Download your saved applications and interview records
        as CSV files.
      </p>

      <div style={{
        display: 'flex',
        gap: 12,
        flexWrap: 'wrap',
        marginTop: 16
      }}>
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => exportData(
            '/api/v1/applications',
            'applications',
            'careerpilot_applications.csv',
            [
              'id',
              'company',
              'job_title',
              'job_url',
              'status',
              'created_at',
              'updated_at'
            ]
          )}
        >
          {busy === 'applications'
            ? 'Exporting...'
            : 'Export Applications CSV'}
        </button>

        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => exportData(
            '/api/v1/interviews',
            'interviews',
            'careerpilot_interviews.csv',
            [
              'id',
              'application_id',
              'company',
              'job_title',
              'interview_type',
              'scheduled_at',
              'duration_minutes',
              'meeting_link',
              'notes',
              'status'
            ]
          )}
        >
          {busy === 'interviews'
            ? 'Exporting...'
            : 'Export Interviews CSV'}
        </button>
      </div>

      {error && <p role="alert" className="error">{error}</p>}
      {message && <p role="status">{message}</p>}

      <p className="muted">
        Exports contain records returned by the current API.
        Keep downloaded files private because they may contain
        application details and interview notes.
      </p>
    </section>
  )
}
