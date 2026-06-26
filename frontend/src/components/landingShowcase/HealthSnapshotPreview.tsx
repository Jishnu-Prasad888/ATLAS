import { healthSnapshot } from './mockData'

export function HealthSnapshotPreview() {
  return (
    <section className="atlas-landing-panel" aria-label="Health snapshot preview">
      <div className="atlas-landing-panel__header">
        <span>Health snapshot</span>
        <span className="atlas-landing-pill atlas-landing-pill--ok">healthy</span>
      </div>
      <dl className="atlas-landing-health">
        {healthSnapshot.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
