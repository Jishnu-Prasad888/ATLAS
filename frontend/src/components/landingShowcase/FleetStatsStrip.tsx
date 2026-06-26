import { fleetStats } from './mockData'

export function FleetStatsStrip() {
  return (
    <div className="atlas-landing-stat-strip" aria-label="ATLAS fleet highlights">
      {fleetStats.map((stat) => (
        <div className="atlas-landing-stat" key={stat.label}>
          <span className="atlas-landing-stat__label">{stat.label}</span>
          <strong style={{ color: stat.accent }}>{stat.value}</strong>
          <span>{stat.detail}</span>
        </div>
      ))}
    </div>
  )
}
