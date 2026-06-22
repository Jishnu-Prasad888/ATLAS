import { useState } from 'react'
import { runAiGraph, type AiRunResponse } from '@/api/ai'
import { PageHeader } from '@/components/layout/AppLayout'
import { Card, Button, Input, Textarea, LoadingState, ErrorState } from '@/components/common'

export function AiWorkbenchPage() {
  const [url, setUrl] = useState('')
  const [params, setParams] = useState('{}')
  const [inputData, setInputData] = useState('{}')
  const [code, setCode] = useState('# write python here\nresult = {"ok": True}')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AiRunResponse | null>(null)

  const onRun = async () => {
    setError(null)
    setLoading(true)
    try {
      const parsedParams = params ? JSON.parse(params) : {}
      const parsedInput = inputData ? JSON.parse(inputData) : {}
      const res = await runAiGraph({
        fetch: { url, params: parsedParams },
        code,
        input_data: parsedInput,
      })
      setResult(res)
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Run failed'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="AI Workbench" subtitle="Fetch data then run sandboxed Python" />

      <Card>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold">Fetch URL</span>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold">Params (JSON)</span>
            <Textarea value={params} onChange={(e) => setParams(e.target.value)} rows={4} spellCheck={false} />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold">Input Data (JSON)</span>
            <Textarea value={inputData} onChange={(e) => setInputData(e.target.value)} rows={4} spellCheck={false} />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold">Python Code</span>
            <Textarea value={code} onChange={(e) => setCode(e.target.value)} rows={12} spellCheck={false} />
          </label>

          <Button onClick={onRun} disabled={loading || !url}>
            {loading ? 'Running...' : 'Run'}
          </Button>
        </div>
      </Card>

      {loading && <LoadingState label="Executing..." />}
      {error && <ErrorState error={`Run failed: ${error}`} />}

      {result && (
        <Card>
          <div className="flex flex-col gap-2 text-sm">
            <div>Duration: {result.duration_ms} ms</div>
            <div className="font-semibold">Fetch Result</div>
            <pre className="bg-black/5 p-2 rounded text-xs overflow-auto max-h-64">{JSON.stringify(result.fetch_result, null, 2)}</pre>
            <div className="font-semibold">Exec Result</div>
            <pre className="bg-black/5 p-2 rounded text-xs overflow-auto max-h-64">{JSON.stringify(result.exec_result, null, 2)}</pre>
          </div>
        </Card>
      )}
    </div>
  )
}

export default AiWorkbenchPage
