import { useState, type FormEvent } from 'react'
import { useServerConfig, useRetentionPolicy } from '@/hooks'
import { configApi, telemetryApi } from '@/api'
import { useUiStore } from '@/store/uiStore'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/hooks/queryKeys'
import { PageHeader } from '@/components/layout/AppLayout'
import {
  Card,
  Button,
  Input,
  ConfirmDialog,
  LoadingState,
  EmptyState,
  ErrorState,
  SectionHeader,
  KvRow,
} from '@/components/common'
import { validateIntervalSeconds, validateRetentionDays, formatTimestamp } from '@/utils'
import type { RetentionPolicy, ServerConfig } from '@/types'

export function ConfigPage() {
  const addNotification = useUiStore((s) => s.addNotification)
  const qc = useQueryClient()

  const { data: configs, isLoading: configsLoading, error: configsError, refetch: refetchConfigs } = useServerConfig()
  const { data: retention, isLoading: retentionLoading } = useRetentionPolicy()

  const [showPruneConfirm, setShowPruneConfirm] = useState(false)
  const [pruning, setPruning] = useState(false)

  const handlePrune = async () => {
    setShowPruneConfirm(false)
    setPruning(true)
    try {
      const res = await telemetryApi.prune()
      const total = Object.values(res.pruned).reduce((a, b) => a + b, 0)
      addNotification({ type: 'success', title: `Pruned ${total} metric records` })
    } catch (e: unknown) {
      addNotification({ type: 'error', title: 'Prune failed', message: e instanceof Error ? e.message : undefined })
    } finally {
      setPruning(false)
    }
  }

  const handleDeleteConfig = async (key: string) => {
    try {
      await configApi.delete(key)
      qc.invalidateQueries({ queryKey: queryKeys.config() })
      addNotification({ type: 'success', title: `Deleted key "${key}"` })
    } catch (e: unknown) {
      addNotification({ type: 'error', title: 'Failed to delete key', message: e instanceof Error ? e.message : undefined })
    }
  }

  return (
    <div>
      <PageHeader title="Configuration" subtitle="Server settings and retention policies" />

      {showPruneConfirm && (
        <ConfirmDialog
          title="Run data retention prune"
          message="This will delete telemetry data older than the configured retention thresholds. Continue?"
          confirmLabel="Prune"
          danger
          onConfirm={handlePrune}
          onCancel={() => setShowPruneConfirm(false)}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Retention policy */}
        <Card>
          <SectionHeader
            title="Retention Policy"
            action={
              <Button size="sm" variant="danger" onClick={() => setShowPruneConfirm(true)} loading={pruning}>
                Prune Now
              </Button>
            }
          />
          {retentionLoading ? (
            <LoadingState />
          ) : retention ? (
            <RetentionForm retention={retention} />
          ) : (
            <EmptyState message="No retention policy" />
          )}
        </Card>

        {/* Config keys */}
        <Card>
          <SectionHeader title="Server Config Keys" />
          {configsLoading ? (
            <LoadingState />
          ) : configsError ? (
            <ErrorState error="Failed to load config" onRetry={refetchConfigs} />
          ) : !configs?.length ? (
            <EmptyState message="No configuration keys" />
          ) : (
            <div className="space-y-3">
              {configs.map((c) => (
                <ConfigKeyRow key={c.key} config={c} onDelete={handleDeleteConfig} />
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function RetentionForm({ retention }: { retention: RetentionPolicy }) {
  const addNotification = useUiStore((s) => s.addNotification)
  const qc = useQueryClient()
  const [rawHours, setRawHours] = useState(String(retention.raw_hours))
  const [rollup1m, setRollup1m] = useState(String(retention.rollup_1m_days))
  const [rollup1h, setRollup1h] = useState(String(retention.rollup_1h_days))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    setErrors({})

    const fieldErrors: Record<string, string> = {}
    const rhErr = validateRetentionDays(Number(rawHours))
    if (rhErr) fieldErrors.raw_hours = rhErr
    const r1mErr = validateRetentionDays(Number(rollup1m))
    if (r1mErr) fieldErrors.rollup_1m = r1mErr
    const r1hErr = validateRetentionDays(Number(rollup1h))
    if (r1hErr) fieldErrors.rollup_1h = r1hErr

    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors)
      return
    }

    setSaving(true)
    try {
      await configApi.setRetention({
        raw_hours: Number(rawHours),
        rollup_1m_days: Number(rollup1m),
        rollup_1h_days: Number(rollup1h),
      })
      qc.invalidateQueries({ queryKey: queryKeys.retention() })
      addNotification({ type: 'success', title: 'Retention policy saved' })
    } catch (e: unknown) {
      addNotification({ type: 'error', title: 'Failed to save retention', message: e instanceof Error ? e.message : undefined })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-3" noValidate>
      <Input
        label="Raw data (hours)"
        type="number"
        value={rawHours}
        onChange={(e) => setRawHours(e.target.value)}
        error={errors.raw_hours}
        hint="Raw 1-second samples kept for N hours"
        min="1"
      />
      <Input
        label="1-minute rollup (days)"
        type="number"
        value={rollup1m}
        onChange={(e) => setRollup1m(e.target.value)}
        error={errors.rollup_1m}
        hint="Per-minute aggregates kept for N days"
        min="1"
      />
      <Input
        label="1-hour rollup (days)"
        type="number"
        value={rollup1h}
        onChange={(e) => setRollup1h(e.target.value)}
        error={errors.rollup_1h}
        hint="Per-hour aggregates kept for N days"
        min="1"
      />
      <Button type="submit" variant="primary" size="sm" loading={saving}>
        Save Retention
      </Button>
    </form>
  )
}

function ConfigKeyRow({ config, onDelete }: { config: ServerConfig; onDelete: (key: string) => void }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border border-[--color-border] rounded">
      <div className="flex items-stretch">
        <button
          className="flex-1 text-left px-3 py-2 flex items-center justify-between gap-2 hover:bg-[--color-surface-2] transition-colors"
          onClick={() => setExpanded((v) => !v)}
        >
          <div className="min-w-0">
            <span className="text-xs font-mono text-[--color-text] font-medium">{config.key}</span>
            {config.encrypted && (
              <span className="ml-2 text-xs font-mono text-[--color-text-dim]">encrypted</span>
            )}
          </div>
          <span className="text-xs font-mono text-[--color-text-dim] shrink-0">{config.updated_by}</span>
        </button>
        <span
          onClick={(e) => { e.stopPropagation(); onDelete(config.key) }}
          className="flex items-center px-2.5 text-xs font-mono text-red-500 hover:text-red-400 hover:bg-red-950/30 transition-colors border-l border-[--color-border] cursor-pointer"
        >
          delete
        </span>
      </div>
      {expanded && (
        <div className="px-3 py-2 border-t border-[--color-border] bg-[--color-surface-2]">
          <pre className="text-xs font-mono text-[--color-text-muted] whitespace-pre-wrap break-all">
            {JSON.stringify(config.value, null, 2)}
          </pre>
          <p className="text-xs font-mono text-[--color-text-dim] mt-2">
            Updated {formatTimestamp(config.updated_at)}
          </p>
          {config.description && (
            <p className="text-xs font-mono text-[--color-text-muted] mt-1">{config.description}</p>
          )}
        </div>
      )}
    </div>
  )
}
