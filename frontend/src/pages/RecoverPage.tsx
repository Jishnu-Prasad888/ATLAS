import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { authApi } from '@/api'
import { ApiError } from '@/api'
import { Button, Input, Card } from '@/components/common'
import { validatePassword, validateRecoveryKey, mapServerErrors } from '@/utils'
import { useCopyToClipboard } from '@/hooks'

export function RecoverPage() {
  const [step, setStep] = useState<'form' | 'success'>('form')
  const [username, setUsername] = useState('')
  const [recoveryKey, setRecoveryKey] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newKey, setNewKey] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const { copied, copy } = useCopyToClipboard()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setErrors({})

    const fieldErrors: Record<string, string> = {}
    if (!username.trim()) fieldErrors.username = 'Username is required.'
    const keyErr = validateRecoveryKey(recoveryKey)
    if (keyErr) fieldErrors.recovery_key = keyErr
    const pwErr = validatePassword(newPassword)
    if (pwErr) fieldErrors.new_password = pwErr

    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors)
      return
    }

    setLoading(true)

    try {
      const res = await authApi.recoverPassword(username.trim(), recoveryKey.trim(), newPassword)
      setNewKey(res.new_recovery_key)
      setStep('success')
    } catch (err) {
      if (err instanceof ApiError) {
        const mapped = mapServerErrors(err.body ?? {})
        setErrors(mapped)
      } else {
        setErrors({ _global: 'An unexpected error occurred.' })
      }
    } finally {
      setLoading(false)
    }
  }

  if (step === 'success') {
    return (
      <div className="min-h-screen bg-[--color-bg] flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="mb-6">
            <p className="text-xs font-mono text-[--color-text-dim] uppercase tracking-widest mb-1">Beacon</p>
            <h1 className="text-lg font-mono font-semibold text-[--color-text]">Password reset</h1>
          </div>

          <Card className="space-y-4">
            <p className="text-xs text-yellow-400 font-mono border border-yellow-900 bg-yellow-950/30 p-2 rounded">
              Your new recovery key is shown below. Save it now — it will not be shown again.
            </p>

            <div className="bg-[--color-bg] rounded border border-[--color-border] p-3">
              <p className="text-sm font-mono text-green-400 tracking-widest text-center select-all break-all">
                {newKey}
              </p>
            </div>

            <button
              onClick={() => copy(newKey)}
              className="w-full h-7 rounded border border-[--color-border] text-xs font-mono text-[--color-text-muted] hover:text-[--color-text] hover:border-[--color-border-strong] transition-colors"
            >
              {copied ? 'Copied to clipboard' : 'Copy to clipboard'}
            </button>

            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" id="saved-key-confirm" className="mt-0.5" />
              <span className="text-xs font-mono text-[--color-text-muted]">
                I have saved this recovery key in a secure location.
              </span>
            </label>

            <Link
              to="/login"
              className="block w-full text-center h-8 leading-8 rounded border border-[--color-border] text-xs font-mono text-[--color-text-muted] hover:text-[--color-text] hover:bg-[--color-surface-2] transition-colors"
            >
              Back to sign in
            </Link>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[--color-bg] flex items-center justify-center p-4">
      <div className="w-full max-w-xs">
        <div className="mb-8">
          <p className="text-xs font-mono text-[--color-text-dim] uppercase tracking-widest mb-1">Beacon</p>
          <h1 className="text-lg font-mono font-semibold text-[--color-text]">Account recovery</h1>
          <p className="text-xs text-[--color-text-muted] mt-1 font-mono">Reset password using recovery key</p>
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
            label="Recovery Key"
            value={recoveryKey}
            onChange={(e) => setRecoveryKey(e.target.value)}
            error={errors.recovery_key}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            autoComplete="off"
            disabled={loading}
          />

          <Input
            label="New Password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            error={errors.new_password}
            hint="Minimum 12 characters"
            autoComplete="new-password"
            disabled={loading}
          />

          <div className="pt-1">
            <Button type="submit" variant="primary" size="md" loading={loading} className="w-full">
              Reset password
            </Button>
          </div>
        </form>

        <div className="mt-4 text-center">
          <Link
            to="/login"
            className="text-xs font-mono text-[--color-text-muted] hover:text-[--color-text] transition-colors"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
