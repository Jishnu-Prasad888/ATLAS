import { Sparkline } from '@/components/common'
import { metrics, network } from './mockData'

function ArcGauge({
  label,
  value,
  detail,
  history,
  accent,
}: {
  label: string
  value: number
  detail: string
  history: number[]
  accent: string
}) {
  const radius = 34
  const cx = 42
  const cy = 42
  const circumference = Math.PI * radius
  const progress = Math.min(1, Math.max(0, value / 100))

  return (
    <div className="atlas-landing-gauge">
      <div className="atlas-landing-gauge__arc">
        <svg width="88" height="58" viewBox="0 0 88 62" aria-hidden>
          <path
            d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
            fill="none"
            stroke="rgba(148, 163, 184, 0.2)"
            strokeLinecap="round"
            strokeWidth="7"
          />
          <path
            d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
            fill="none"
            stroke={accent}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
            strokeLinecap="round"
            strokeWidth="7"
          />
        </svg>
        <strong style={{ color: accent }}>{value}</strong>
      </div>
      <span className="atlas-landing-gauge__label">{label}</span>
      <span className="atlas-landing-gauge__detail">{detail}</span>
      <Sparkline values={history} color={accent} width={96} height={24} />
    </div>
  )
}

export function LiveMetricsPreview() {
  return (
    <section className="atlas-landing-panel atlas-landing-metrics" aria-label="Live metric preview">
      <div className="atlas-landing-panel__header">
        <span>Live metrics</span>
        <span className="atlas-landing-panel__aux">prod-edge-07</span>
      </div>
      <div className="atlas-landing-gauge-grid">
        {metrics.map((metric) => (
          <ArcGauge key={metric.label} {...metric} />
        ))}
      </div>
      <div className="atlas-landing-network">
        <div>
          <span>{network.iface} RX</span>
          <strong>{network.rx}</strong>
          <Sparkline values={network.rxHistory} color="#34d399" width={120} height={26} />
        </div>
        <div>
          <span>{network.iface} TX</span>
          <strong>{network.tx}</strong>
          <Sparkline values={network.txHistory} color="#60a5fa" width={120} height={26} />
        </div>
      </div>
    </section>
  )
}
