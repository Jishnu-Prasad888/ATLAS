import { Tag } from '@/components/common'
import { activeAgent } from './mockData'

export function AgentFocusPreview() {
  return (
    <section className="atlas-landing-panel atlas-landing-agent" aria-label="Selected agent preview">
      <div className="atlas-landing-panel__header">
        <span>Agent focus</span>
        <span className="atlas-landing-pill atlas-landing-pill--ok">{activeAgent.status}</span>
      </div>
      <div className="atlas-landing-agent__title">
        <div>
          <strong>{activeAgent.hostname}</strong>
          <span>{activeAgent.id}</span>
        </div>
        <span>{activeAgent.lastSeen}</span>
      </div>
      <div className="atlas-landing-tags">
        {activeAgent.tags.map((tag) => (
          <Tag key={tag}>{tag}</Tag>
        ))}
      </div>
      <dl className="atlas-landing-kv-grid">
        <div>
          <dt>OS</dt>
          <dd>{activeAgent.os}</dd>
        </div>
        <div>
          <dt>Architecture</dt>
          <dd>{activeAgent.architecture}</dd>
        </div>
        <div>
          <dt>Agent</dt>
          <dd>{activeAgent.version}</dd>
        </div>
        <div>
          <dt>Mode</dt>
          <dd>WebSocket live</dd>
        </div>
      </dl>
    </section>
  )
}
