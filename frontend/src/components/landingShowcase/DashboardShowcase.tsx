import { useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { AgentFocusPreview } from './AgentFocusPreview'
import { FleetStatsStrip } from './FleetStatsStrip'
import { HealthSnapshotPreview } from './HealthSnapshotPreview'
import { LiveMetricsPreview } from './LiveMetricsPreview'
import { SignalLogPreview } from './SignalLogPreview'

export function DashboardShowcase() {
  const [tilt, setTilt] = useState<{ rotateX: number; rotateY: number; depth: number }>({
    rotateX: 0,
    rotateY: 0,
    depth: 0,
  })

  const updateTilt = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen') {
      return
    }

    const bounds = event.currentTarget.getBoundingClientRect()
    const relativeX = (event.clientX - bounds.left) / bounds.width
    const relativeY = (event.clientY - bounds.top) / bounds.height
    const clampX = Math.min(Math.max(relativeX, 0), 1)
    const clampY = Math.min(Math.max(relativeY, 0), 1)
    const tiltRange = 7
    const rotateY = (0.5 - clampX) * tiltRange
    const rotateX = (0.5 - clampY) * tiltRange
    const edgeBias = Math.max(Math.abs(0.5 - clampX), Math.abs(0.5 - clampY))
    const depth = -8 * edgeBias

    setTilt({ rotateX, rotateY, depth })
  }

  const resetTilt = () => {
    setTilt({ rotateX: 0, rotateY: 0, depth: 0 })
  }

  const tiltStyle: CSSProperties = {
    '--atlas-console-rotateX': `${tilt.rotateX}deg`,
    '--atlas-console-rotateY': `${tilt.rotateY}deg`,
    '--atlas-console-translateZ': `${tilt.depth}px`,
  }

  return (
    <div
      className="atlas-landing-console"
      aria-label="Mock ATLAS dashboard preview"
      onPointerEnter={updateTilt}
      onPointerMove={updateTilt}
      onPointerLeave={resetTilt}
      style={tiltStyle}
    >
      <div className="atlas-landing-console__bar">
        <span>ATLAS command surface</span>
        <div>
          <span />
          <span />
          <span />
        </div>
      </div>
      <FleetStatsStrip />
      <div className="atlas-landing-console__grid">
        <AgentFocusPreview />
        <LiveMetricsPreview />
        <HealthSnapshotPreview />
        <SignalLogPreview />
      </div>
    </div>
  )
}
