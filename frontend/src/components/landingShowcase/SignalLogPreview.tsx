import { SeverityBadge } from '@/components/common'
import { signals } from './mockData'

export function SignalLogPreview() {
  return (
    <section className="atlas-landing-panel atlas-landing-signals" aria-label="Signal log preview">
      <div className="atlas-landing-panel__header">
        <span>Signals</span>
        <span className="atlas-landing-panel__aux">5 recent events</span>
      </div>
      <ul>
        {signals.map((signal) => (
          <li key={signal.id}>
            <div>
              <SeverityBadge severity={signal.severity} />
              <span>{signal.message}</span>
            </div>
            <small>
              {signal.source} / {signal.time}
            </small>
          </li>
        ))}
      </ul>
    </section>
  )
}
