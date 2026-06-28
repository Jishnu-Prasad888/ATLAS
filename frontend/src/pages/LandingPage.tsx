import { Link } from 'react-router-dom'
import { Cpu, Globe2, KeyRound, Smartphone } from 'lucide-react'
import { BrandLogo } from '@/components/common'
import { useAuthStore } from '@/store/authStore'
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
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const dashboardHref = isAuthenticated ? '/' : '/login'

  return (
    <main className="atlas-landing">
      <header className="atlas-landing-navbar" aria-label="Site navigation">
        <Link to="/landing" className="atlas-landing-navbar__brand">
          <BrandLogo height={38} />
          <div className="atlas-landing-navbar__brand-text">
            <strong>ATLAS</strong>
            <span>Telemetry Command Surface</span>
          </div>
        </Link>

        <nav className="atlas-landing-navbar__actions" aria-label="Landing page actions">
          <Link
            to={dashboardHref}
            className="atlas-landing-button atlas-landing-button--primary atlas-landing-navbar__button"
          >
            Open dashboard
          </Link>
          <a
            href="https://github.com/Jishnu-Prasad888/ATLAS"
            target="_blank"
            rel="noreferrer"
            className="atlas-landing-navbar__icon"
            aria-label="View ATLAS on GitHub"
          >
            <svg
              className="atlas-landing-navbar__icon-mark"
              viewBox="0 0 24 24"
              aria-hidden
              focusable="false"
            >
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.387.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.758-1.333-1.758-1.09-.745.084-.73.084-.73 1.205.084 1.84 1.236 1.84 1.236 1.07 1.835 2.807 1.305 3.492.998.108-.776.42-1.305.763-1.605-2.665-.305-5.467-1.332-5.467-5.93 0-1.31.468-2.38 1.235-3.22-.124-.303-.535-1.524.117-3.176 0 0 1.007-.322 3.3 1.23a11.52 11.52 0 0 1 3.003-.404c1.02.005 2.045.138 3.003.404 2.29-1.552 3.295-1.23 3.295-1.23.655 1.653.244 2.874.12 3.176.77.84 1.233 1.91 1.233 3.22 0 4.61-2.807 5.62-5.48 5.92.43.372.816 1.102.816 2.222 0 1.606-.015 2.896-.015 3.286 0 .322.216.697.825.578C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12z" />
            </svg>
            <span>GitHub</span>
          </a>
        </nav>
      </header>

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
