import { Cpu, Globe2, KeyRound, Smartphone } from 'lucide-react'
import { FeatureBands, LandingHero, ProposalExplorer, TechnicalDepth } from '@/components/landingShowcase'
import Lightfall from '@/components/landingShowcase/Lightfall'
import './landing-page.css'

const platformAccess = [
  { label: 'Web console', detail: 'The full fleet surface for daily operations.', icon: Globe2 },
  { label: 'Mobile', detail: 'Quick checks when you are away from the desk.', icon: Smartphone },
  { label: 'APIs', detail: 'REST and GraphQL access for automation.', icon: KeyRound },
  { label: 'Agent TUI', detail: 'Local terminal view on the host itself.', icon: Cpu },
]

export function LandingPage() {
  return (
    <main className="atlas-landing">
      <div className="atlas-landing-lightfall" aria-hidden>
        <Lightfall
          colors={['#A6C8FF', '#5227FF', '#FF9FFC']}
          backgroundColor="#07113d"
          speed={0.5}
          streakCount={2}
          streakWidth={1}
          streakLength={1}
          glow={0.82}
          density={0.6}
          twinkle={1}
          zoom={3}
          backgroundGlow={0.45}
          opacity={0.72}
          mouseInteraction
          mouseStrength={0.5}
          mouseRadius={1}
          color1="#A6C8FF"
          color2="#5227FF"
          color3="#FF9FFC"
        />
      </div>
      <div className="atlas-landing-grid-bg" aria-hidden />
      <LandingHero />
      <FeatureBands />
      <TechnicalDepth />
      <ProposalExplorer />
      <section className="atlas-landing-access" aria-label="Access surfaces">
        <div className="atlas-landing-access-shell">
          <div className="atlas-landing-section-copy">
            <span>Access surfaces</span>
            <h2>Use the same truth everywhere.</h2>
          </div>
          <div className="atlas-landing-access-grid">
            {platformAccess.map((item) => {
              const Icon = item.icon
              return (
                <article key={item.label}>
                  <Icon size={22} aria-hidden />
                  <h3>{item.label}</h3>
                  <p>{item.detail}</p>
                </article>
              )
            })}
          </div>
        </div>
      </section>
    </main>
  )
}
