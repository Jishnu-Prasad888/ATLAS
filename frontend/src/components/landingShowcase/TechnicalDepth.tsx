import { Boxes, Clock3, LockKeyhole, Network, ShieldCheck, Workflow } from 'lucide-react'
import {
  architectureHighlights,
  operationFlow,
  platformCapabilities,
  resilienceDetails,
  securityLayers,
} from './mockData'

export function TechnicalDepth() {
  return (
    <section className="atlas-landing-depth" aria-label="Technical architecture details">
      <div className="atlas-landing-section-copy">
        <span>Design details</span>
        <h2>Important parts from the architecture proposal.</h2>
        <p>
          The system is built as a fleet control plane plus Linux agents, with durable transport,
          approved operations, strict authorization, and recovery paths for bad networks.
        </p>
      </div>

      <div className="atlas-landing-architecture-grid">
        {architectureHighlights.map((item, index) => {
          const Icon = [Network, Boxes, Workflow, Clock3][index]
          return (
            <article key={item.label} className="atlas-landing-architecture-card">
              <Icon size={22} aria-hidden />
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <p>{item.detail}</p>
            </article>
          )
        })}
      </div>

      <div className="atlas-landing-deep-panels">
        <article className="atlas-landing-deep-panel atlas-landing-deep-panel--wide">
          <div className="atlas-landing-deep-panel__title">
            <Workflow size={22} aria-hidden />
            <div>
              <span>Approved operations</span>
              <h3>Not a shell wrapper.</h3>
            </div>
          </div>
          <ol>
            {operationFlow.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </article>

        <article className="atlas-landing-deep-panel">
          <div className="atlas-landing-deep-panel__title">
            <ShieldCheck size={22} aria-hidden />
            <div>
              <span>Failure handling</span>
              <h3>Designed for interrupted work.</h3>
            </div>
          </div>
          <ul>
            {resilienceDetails.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="atlas-landing-deep-panel">
          <div className="atlas-landing-deep-panel__title">
            <LockKeyhole size={22} aria-hidden />
            <div>
              <span>Security perimeter</span>
              <h3>Authorization is server-side.</h3>
            </div>
          </div>
          <ul>
            {securityLayers.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </div>

      <div className="atlas-landing-capability-rail" aria-label="Additional platform capabilities">
        {platformCapabilities.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
    </section>
  )
}
