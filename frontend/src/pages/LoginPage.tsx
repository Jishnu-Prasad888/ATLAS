import { useState, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { authApi } from '@/api'
import { useAuthStore } from '@/store/authStore'
import { wsClient } from '@/ws/client'
import { Button, Input } from '@/components/common'
import { ApiError } from '@/api'
import { mapServerErrors } from '@/utils'

export function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)

  const login = useAuthStore((s) => s.login)
  const navigate = useNavigate()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setErrors({})

    const fieldErrors: Record<string, string> = {}

    if (!username.trim()) {
      fieldErrors.username = 'Username is required.'
    }

    if (!password) {
      fieldErrors.password = 'Password is required.'
    }

    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors)
      return
    }

    setLoading(true)

    try {
      const tokens = await authApi.login(username.trim(), password)
      login(tokens.access, tokens.refresh)
      wsClient.connect(tokens.access)
      navigate('/', { replace: true })
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 400) {
          const mapped = mapServerErrors(err.body ?? {})
          setErrors(mapped)
        } else if (err.status === 429) {
          setErrors({ _global: 'Too many login attempts. Try again in a moment.' })
        } else {
          setErrors({ _global: err.message })
        }
      } else {
        setErrors({ _global: 'An unexpected error occurred.' })
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[--color-bg] flex items-center justify-center p-4">
      <div className="w-full max-w-xs">
        {/* Header */}
        <div className="mb-8">
          <p className="text-xs font-mono text-[--color-text-dim] uppercase tracking-widest mb-1">Beacon</p>
          <h1 className="text-lg font-mono font-semibold text-[--color-text]">Sign in</h1>
          <p className="text-xs text-[--color-text-muted] mt-1 font-mono">Observability platform</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3" noValidate>
          {errors._global && (
            <p className="text-xs font-mono text-red-400 p-2 rounded border border-red-900 bg-red-950/30">
              {errors._global}
            </p>
          )}

          <Input
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            error={errors.username}
            autoComplete="username"
            autoFocus
            disabled={loading}
          />

          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            autoComplete="current-password"
            disabled={loading}
          />

          <div className="pt-1">
            <Button
              type="submit"
              variant="primary"
              size="md"
              loading={loading}
              className="w-full"
            >
              Sign in
            </Button>
          </div>
        </form>

        <div className="mt-4 text-center">
          <Link
            to="/recover"
            className="text-xs font-mono text-[--color-text-muted] hover:text-[--color-text] transition-colors"
          >
            Forgot password? Use recovery key
          </Link>
        </div>
      </div>
    </div>
  )
}
