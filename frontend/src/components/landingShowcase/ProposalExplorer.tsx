import { useMemo, useState } from 'react'
import { ArrowUpRight, Cpu, Database, GitBranch, RadioTower } from 'lucide-react'
import {
  comparisonSystems,
  deploymentBudget,
  operationBadges,
  proposalExplorerPanels,
  roadmapPhases,
  topologyNodes,
  type ExplorerPanelId,
} from './mockData'

const panelOrder: ExplorerPanelId[] = ['topology', 'operations', 'deployment', 'roadmap']

export function ProposalExplorer() {
  const [activePanel, setActivePanel] = useState<ExplorerPanelId>('topology')
  const panel = proposalExplorerPanels[activePanel]

  const activeIcon = useMemo(() => {
    if (activePanel === 'operations') return GitBranch
    if (activePanel === 'deployment') return Database
    if (activePanel === 'roadmap') return Cpu
    return RadioTower
  }, [activePanel])
  const Icon = activeIcon

  return (
    <section className="atlas-landing-explorer" aria-label="Interactive proposal explorer">
      <div className="atlas-landing-explorer__header">
        <div className="atlas-landing-section-copy">
          <span>Proposal explorer</span>
          <h2>Click through the architecture.</h2>
          <p>
            More from the proposal deck: topology, approved operations, deployment budget,
            comparable systems, and roadmap.
          </p>
        </div>
        <div className="atlas-landing-explorer__tabs" role="tablist" aria-label="Proposal sections">
          {panelOrder.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activePanel === id}
              className={activePanel === id ? 'is-active' : undefined}
              onClick={() => setActivePanel(id)}
            >
              {proposalExplorerPanels[id].label}
            </button>
          ))}
        </div>
      </div>

      <div className="atlas-landing-explorer__body">
        <article className="atlas-landing-explorer-card">
          <div className="atlas-landing-explorer-card__title">
            <Icon size={24} aria-hidden />
            <div>
              <span>{panel.eyebrow}</span>
              <h3>{panel.title}</h3>
            </div>
          </div>
          <p>{panel.body}</p>

          {activePanel === 'topology' && (
            <div className="atlas-landing-topology" aria-label="Animated system topology">
              {topologyNodes.map((node, index) => (
                <span key={node} style={{ ['--node-index' as string]: index }}>
                  {node}
                </span>
              ))}
            </div>
          )}

          {activePanel === 'operations' && (
            <div className="atlas-landing-operation-cloud">
              {operationBadges.map((badge) => (
                <span key={badge}>{badge}</span>
              ))}
            </div>
          )}

          {activePanel === 'deployment' && (
            <div className="atlas-landing-budget-table">
              {deploymentBudget.map((item) => (
                <div key={item.component}>
                  <span>{item.component}</span>
                  <strong>{item.cpu}</strong>
                  <em>{item.memory}</em>
                </div>
              ))}
            </div>
          )}

          {activePanel === 'roadmap' && (
            <ol className="atlas-landing-roadmap">
              {roadmapPhases.map((phase, index) => (
                <li key={phase}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  {phase}
                </li>
              ))}
            </ol>
          )}
        </article>

        <aside className="atlas-landing-fit-panel" aria-label="Comparable systems">
          <div className="atlas-landing-fit-panel__heading">
            <span>Where it fits</span>
            <ArrowUpRight size={18} aria-hidden />
          </div>
          <p>ATLAS and Beacon sit where automation, monitoring, fleet visibility, and audit meet.</p>
          <ul>
            {comparisonSystems.map((system) => (
              <li key={system.name}>
                <strong>{system.name}</strong>
                <span>{system.overlap}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  )
}
