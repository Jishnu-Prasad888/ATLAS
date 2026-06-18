import { useState, type FormEvent } from 'react'
import { authApi } from '@/api'
import { ApiError } from '@/api'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import { PageHeader } from '@/components/layout/AppLayout'
import {
  Card,
  Button,
  Input,
  SectionHeader,
  KvRow,
} from '@/components/common'
import { validatePassword, mapServerErrors } from '@/utils'
import { useCopyToClipboard } from '@/hooks'
import { env } from '@/config/env'

export function SettingsPage() {
  const { user } = useAuthStore()
  const addNotification = useUiStore((s) => s.addNotification)
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null)
  const [generatingKey, setGeneratingKey] = useState(false)
  const { copied, copy } = useCopyToClipboard()
  const [confirmed, setConfirmed] = useState(false)

  const handleGenerateKey = async () => {
    setGeneratingKey(true)
    try {
      const res = await authApi.generateRecoveryKey()
      setRecoveryKey(res.recovery_key)
      setConfirmed(false)
    } catch (e: unknown) {
      addNotification({ type: 'error', title: 'Failed to generate key', message: e instanceof Error ? e.message : undefined })
    } finally {
      setGeneratingKey(false)
    }
  }

  return (
    <div>
      <PageHeader title="Settings" subtitle="Account and connection settings" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Profile */}
        <Card>
          <SectionHeader title="Account" />
          <KvRow label="Username" value={user?.username ?? '--'} />
          <KvRow label="Role" value={user?.role ?? '--'} />
        </Card>

        {/* Server config */}
        <Card>
          <SectionHeader title="Connection" />
          <KvRow label="API Base" value={env.restBase || 'proxy (same origin)'} />
          <KvRow label="WebSocket" value={env.wsUrl} />
          <p className="text-xs text-[--color-text-dim] font-mono mt-3">
            To change server connection settings, update environment variables and rebuild.
          </p>
        </Card>

        {/* Theme */}
        <Card>
          <SectionHeader title="Theme" />
          <p className="text-xs text-[--color-text-muted] font-mono mb-4 leading-relaxed">
            Switch between dark and light mode.
          </p>
          <div className="flex items-center gap-3">
            <Button
              variant={theme === 'dark' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setTheme('dark')}
            >
              Dark
            </Button>
            <Button
              variant={theme === 'light' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setTheme('light')}
            >
              Light
            </Button>
          </div>
        </Card>

        {/* Password change */}
        <Card>
          <SectionHeader title="Change Password" />
          <PasswordChangeForm />
        </Card>

        {/* Recovery key */}
        <Card>
          <SectionHeader title="Recovery Key" />
          <p className="text-xs text-[--color-text-muted] font-mono mb-4 leading-relaxed">
            A recovery key lets you reset your password without administrator assistance.
            Generating a new key invalidates the previous one.
          </p>

          {recoveryKey ? (
            <div className="space-y-3">
              <p className="text-xs font-mono text-yellow-400 border border-yellow-900 bg-yellow-950/30 p-2 rounded">
                Save this key now. It will not be shown again.
              </p>
              <div className="bg-[--color-bg] rounded border border-[--color-border] p-3">
                <p className="text-sm font-mono text-green-400 tracking-widest text-center select-all break-all">
                  {recoveryKey}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="w-full"
                onClick={() => copy(recoveryKey)}
              >
                {copied ? 'Copied' : 'Copy to clipboard'}
              </Button>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="text-xs font-mono text-[--color-text-muted]">
                  I have saved this key in a secure location.
                </span>
              </label>
              {confirmed && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => setRecoveryKey(null)}
                >
                  Done
                </Button>
              )}
            </div>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleGenerateKey}
              loading={generatingKey}
            >
              Generate Recovery Key
            </Button>
          )}
        </Card>
      </div>
    </div>
  )
}

function PasswordChangeForm() {
  const addNotification = useUiStore((s) => s.addNotification)
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setErrors({})

    const fieldErrors: Record<string, string> = {}
    if (!oldPassword) fieldErrors.old_password = 'Current password is required.'
    const pwErr = validatePassword(newPassword)
    if (pwErr) fieldErrors.new_password = pwErr
    if (newPassword !== confirmPassword) fieldErrors.confirm = 'Passwords do not match.'

    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors)
      return
    }

    setLoading(true)
    try {
      await authApi.changePassword(oldPassword, newPassword)
      addNotification({ type: 'success', title: 'Password changed successfully' })
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      if (err instanceof ApiError && err.body) {
        setErrors(mapServerErrors(err.body as Record<string, string | string[]>))
      } else {
        setErrors({ _global: err instanceof Error ? err.message : 'Failed to change password' })
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3" noValidate>
      {errors._global && (
        <p className="text-xs text-red-400 font-mono">{errors._global}</p>
      )}
      <Input
        label="Current Password"
        type="password"
        value={oldPassword}
        onChange={(e) => setOldPassword(e.target.value)}
        error={errors.old_password}
        autoComplete="current-password"
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
      <Input
        label="Confirm New Password"
        type="password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        error={errors.confirm}
        autoComplete="new-password"
        disabled={loading}
      />
      <Button type="submit" variant="primary" size="sm" loading={loading}>
        Change Password
      </Button>
    </form>
  )
}
