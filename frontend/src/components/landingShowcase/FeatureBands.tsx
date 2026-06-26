import { BrainCircuit, DatabaseZap, LockKeyhole, RadioTower } from 'lucide-react'
import { featureGroups } from './mockData'

const icons = [RadioTower, DatabaseZap, LockKeyhole, BrainCircuit]

export function FeatureBands() {
  return (
    <section className="atlas-landing-features" id="architecture" aria-label="ATLAS feature highlights">
      <div className="atlas-landing-feature-shell">
        <div className="atlas-landing-section-copy">
          <span>Incident flow</span>
          <h2>From noise to evidence.</h2>
          <p>
            Collect the host signal, keep it through outages, secure the control plane, and hand the
            operator a clear trail when something changes.
          </p>
        </div>

        <div className="atlas-landing-flow">
          {featureGroups.map((feature, index) => {
            const Icon = icons[index]
            return (
              <article key={feature.title} className="atlas-landing-feature">
                <div className="atlas-landing-feature__index">0{index + 1}</div>
                <Icon aria-hidden size={22} />
                <span>{feature.eyebrow}</span>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            )
          })}
        </div>

        <aside className="atlas-landing-brief" aria-label="Operational brief">
          <span>Live brief</span>
          <strong>prod-edge-07 recovered with no telemetry gap.</strong>
          <p>
            Queue replay filled the outage window, audit kept the config change, and the analyst view
            tied the restart to a Kubernetes rollout.
          </p>
          <div>
            <code>metrics: continuous</code>
            <code>audit: append-only</code>
            <code>network: restored</code>
          </div>
        </aside>
      </div>
    </section>
  )
}
