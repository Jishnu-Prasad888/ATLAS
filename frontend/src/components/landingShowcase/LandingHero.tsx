import { Activity, ArrowRight, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { BrandLogo } from '@/components/common'
import { useAuthStore } from '@/store/authStore'
import { DashboardShowcase } from './DashboardShowcase'

export function LandingHero() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const dashboardHref = isAuthenticated ? '/' : '/login'

  return (
    <section className="atlas-landing-hero">
      <div className="atlas-landing-hero__copy">
        <div className="atlas-landing-nav">
          <div className="atlas-landing-brand-lockup">
            <BrandLogo height={54} />
            <span className="atlas-landing-brand-tagline">
              Autonomous Telemetry, Logging, Analysis &amp; Surveillance
            </span>
          </div>
          <span>Linux fleet observability</span>
        </div>

        <div className="atlas-landing-kicker">
          <Activity size={16} aria-hidden />
          Rust agents / live telemetry / accountable operations
        </div>

        <h1>Linux operations, live and accountable.</h1>
        <p>
          ATLAS turns fleet metrics, logs, health, and audit history into one sharp command surface.
        </p>

        <div className="atlas-landing-actions">
          <Link className="atlas-landing-button atlas-landing-button--primary" to={dashboardHref}>
            Open dashboard
            <ArrowRight size={17} aria-hidden />
          </Link>
          <a className="atlas-landing-button atlas-landing-button--secondary" href="#architecture">
            View system architecture
          </a>
        </div>

        <div className="atlas-landing-proof">
          <span><ShieldCheck size={15} aria-hidden /> TLS 1.3 encrypted</span>
          <span>Offline replay</span>
          <span>Immutable audit</span>
        </div>
      </div>

      <DashboardShowcase />
    </section>
  )
}
