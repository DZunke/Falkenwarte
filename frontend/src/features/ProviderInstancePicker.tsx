import { useEffect, useId, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { components } from '@/generated/api'
import { RefreshCw } from 'lucide-react'
import { api, formatError, request } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export type ProviderSelection = {
  provider_instance_id: string
  model?: string
  reasoning?: components['schemas']['T3ReasoningSelection']
}

type Props = {
  connectionId: string
  value: ProviderSelection | null
  onChange: (selection: ProviderSelection | null) => void
  onReadyChange: (ready: boolean) => void
}

export function ProviderInstancePicker({ connectionId, value, onChange, onReadyChange }: Props) {
  const id = useId()
  const providerFieldId = `provider-instance-${id}`
  const modelSearchFieldId = `provider-model-search-${id}`
  const modelFieldId = `provider-model-${id}`
  const reasoningFieldId = `provider-reasoning-${id}`
  const defaultReasoningValue = `__t3_standard_${id}__`
  const [search, setSearch] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const inventory = useQuery({
    queryKey: ['connection-providers', connectionId, searchTerm],
    enabled: Boolean(connectionId),
    queryFn: () => request(api.GET('/connections/{connection_id}/providers', {
      params: { path: { connection_id: connectionId }, query: searchTerm ? { search: searchTerm } : {} },
    })),
    retry: false,
  })

  const providers = inventory.data?.providers ?? []
  const availableProviders = providers.filter((provider) => provider.available)
  const selectedProvider = availableProviders.find((provider) => provider.provider_instance_id === value?.provider_instance_id)
  const models = selectedProvider?.models ?? []
  const omittedModels = selectedProvider?.omitted_models ?? 0
  const matchingModel = models.find((model) => model.id === value?.model)
  const selectedModelId = matchingModel?.id ?? (!value?.model && models.length === 1 && omittedModels === 0 ? models[0].id : '')
  const selectedModel = models.find((model) => model.id === selectedModelId)
  const reasoningOption = selectedModel?.reasoning
  const confirmedReasoningValues = reasoningOption?.values.filter((reasoningValue) => reasoningValue.length > 0) ?? []
  const savedReasoning = value?.reasoning
  const savedReasoningIsCurrent = Boolean(savedReasoning
    && reasoningOption?.option_id === savedReasoning.option_id
    && confirmedReasoningValues.includes(savedReasoning.value))
  const savedReasoningIsUnconfirmed = Boolean(savedReasoning && !savedReasoningIsCurrent)
  const showReasoningSelect = Boolean(selectedModel && (reasoningOption || savedReasoning))
  const reasoningSelectValue = savedReasoningIsCurrent && savedReasoning ? savedReasoning.value : savedReasoning ? '' : defaultReasoningValue
  const ready = Boolean(inventory.isSuccess && !inventory.isFetching && selectedProvider && selectedModel && !savedReasoningIsUnconfirmed)

  useEffect(() => {
    onReadyChange(ready)
    if (ready && selectedProvider && selectedModel && (value?.provider_instance_id !== selectedProvider.provider_instance_id || value.model !== selectedModel.id)) {
      onChange({ provider_instance_id: selectedProvider.provider_instance_id, model: selectedModel.id })
    }
  }, [onChange, onReadyChange, ready, selectedModel, selectedProvider, value])

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const term = search.trim()
    setSearchTerm(term)
    if (term === searchTerm) void inventory.refetch()
  }

  return (
    <section className="space-y-3 rounded-lg border p-3" aria-label="T3-Providerinstanz">
      <p className="text-sm text-muted-foreground">Dieser Modus startet jeden Auftrag in einem neuen T3-Thread mit der gewählten Providerinstanz und Modell-ID. Provider und Modelle bleiben in T3 verwaltet.</p>

      {!connectionId && <p role="status" className="text-sm text-muted-foreground">Wähle zuerst eine T3-Verbindung, damit Falkenwarte deren Providerinventar lesen kann.</p>}
      {connectionId && inventory.isPending && <p role="status" className="text-sm text-muted-foreground">Providerinstanzen und Modelle werden aus T3 geladen…</p>}
      {connectionId && inventory.isFetching && !inventory.isPending && <p role="status" className="text-sm text-muted-foreground">T3-Inventar wird aktualisiert…</p>}
      {connectionId && inventory.isError && (
        <div role="alert" className="space-y-1 text-sm text-destructive">
          <p>Provider und Modelle konnten nicht aus T3 geladen werden. {formatError(inventory.error)}</p>
          <a className="underline underline-offset-4" href="#/agents">Verbindung unter Agents &amp; T3 testen</a>
        </div>
      )}

      {connectionId && inventory.isSuccess && (
        <>
          {availableProviders.length > 0 ? (
            <div className="space-y-1.5">
              <Label htmlFor={providerFieldId}>Providerinstanz aus T3</Label>
              <Select
                value={selectedProvider ? value?.provider_instance_id : ''}
                disabled={inventory.isFetching}
                onValueChange={(providerInstanceId) => {
                  setSearch('')
                  setSearchTerm('')
                  onChange({ provider_instance_id: providerInstanceId })
                  onReadyChange(false)
                }}
              >
                <SelectTrigger id={providerFieldId} className="w-full max-w-full" data-testid="provider-instance-picker" aria-label="Providerinstanz aus T3">
                  <SelectValue placeholder="Providerinstanz wählen" />
                </SelectTrigger>
                <SelectContent className="max-w-[min(90vw,36rem)]">
                  {availableProviders.map((provider) => (
                    <SelectItem key={provider.provider_instance_id} className="whitespace-normal break-words" value={provider.provider_instance_id}>
                      {provider.display_name || 'Unbenannte Providerinstanz'} · {provider.provider_instance_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Die T3-Instanz-ID unterscheidet auch mehrere gleichnamige Provider.</p>
            </div>
          ) : (
            <p role="status" className="text-sm text-muted-foreground">{searchTerm ? 'T3 meldet für diese Suche keine verfügbaren Providerinstanzen.' : 'T3 meldet für diese Verbindung keine verfügbaren Providerinstanzen.'}</p>
          )}

          <form className="space-y-2" onSubmit={submitSearch}>
            <div className="space-y-1.5">
              <Label htmlFor={modelSearchFieldId}>Modellsuche in T3</Label>
              <div className="flex flex-wrap gap-2">
                <Input id={modelSearchFieldId} className="min-w-0 flex-1" data-testid="provider-model-search" value={search} maxLength={200} placeholder="Modell-ID oder Name" onChange={(event) => setSearch(event.target.value)} />
                <Button type="submit" variant="outline" disabled={inventory.isFetching || !search.trim()}>Modelle suchen</Button>
                {searchTerm && <Button type="button" variant="ghost" disabled={inventory.isFetching} onClick={() => { setSearch(''); setSearchTerm('') }}>Suche zurücksetzen</Button>}
              </div>
            </div>
          </form>

          {value && !selectedProvider && (
            <div role="status" className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
              <p><strong className="text-foreground">Bisheriges Ziel:</strong> Providerinstanz {value.provider_instance_id}{value.model ? ` · Modell ${value.model}` : ''}</p>
              <p className="mt-1">{searchTerm
                ? 'Setze die Modellsuche zurück, um die Instanz im vollständigen Angebot zu prüfen.'
                : 'T3 meldet diese Instanz als nicht verfügbar. Wähle eine verfügbare Instanz und ein Modell, um das Ziel zu ändern.'}</p>
            </div>
          )}
          {selectedProvider && omittedModels > 0 && <p role="status" className="text-xs text-muted-foreground">T3 zeigt für diese Instanz nur einen Teil der Modelle. Suche nach Modell-ID oder Name; das Kurzlistenmodell wird nicht automatisch ausgewählt.</p>}
          {selectedProvider && value?.model && !matchingModel && <p role="status" className="text-sm text-muted-foreground">Das gespeicherte Modell {value.model} ist in der aktuellen T3-Auswahl nicht enthalten. Suche danach oder wähle bewusst ein anderes Modell, bevor du speicherst.</p>}
          {selectedProvider && models.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor={modelFieldId}>Modell aus T3</Label>
              <Select value={selectedModelId} disabled={inventory.isFetching} onValueChange={(modelId) => onChange({ provider_instance_id: selectedProvider.provider_instance_id, model: modelId })}>
                <SelectTrigger id={modelFieldId} className="w-full max-w-full" data-testid="provider-model-picker" aria-label="Modell aus T3">
                  <SelectValue placeholder={value?.model && !matchingModel ? 'Modell erneut wählen' : 'Modell wählen'} />
                </SelectTrigger>
                <SelectContent className="max-w-[min(90vw,36rem)]">
                  {models.map((model) => (
                    <SelectItem key={model.id} className="whitespace-normal break-words" value={model.id}>{model.label ? `${model.label} · ${model.id}` : model.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">T3 erwartet die konkrete Modell-ID für diesen Provider.</p>
            </div>
          )}
          {showReasoningSelect && selectedModel && (
            <div className="space-y-1.5">
              <Label htmlFor={reasoningFieldId}>Reasoning-Level</Label>
              <Select
                value={reasoningSelectValue}
                disabled={inventory.isFetching}
                onValueChange={(reasoningValue) => {
                  const selection = { provider_instance_id: selectedProvider!.provider_instance_id, model: selectedModel.id }
                  if (reasoningValue === defaultReasoningValue || !reasoningOption) {
                    onChange(selection)
                    return
                  }
                  onChange({ ...selection, reasoning: { option_id: reasoningOption.option_id, value: reasoningValue } })
                }}
              >
                <SelectTrigger id={reasoningFieldId} data-testid="provider-reasoning-picker" aria-label="Reasoning-Level">
                  <SelectValue placeholder={savedReasoningIsUnconfirmed ? 'Reasoning-Level erneut wählen' : 'T3-Standard'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={defaultReasoningValue}>T3-Standard</SelectItem>
                  {confirmedReasoningValues.map((reasoningValue) => <SelectItem key={reasoningValue} value={reasoningValue}>{reasoningValue}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">T3-Standard überlässt die Wahl T3.{reasoningOption?.default ? ` Gemeldeter T3-Standard: ${reasoningOption.default}.` : ''}</p>
            </div>
          )}
          {savedReasoning && savedReasoningIsUnconfirmed && (
            <p role="status" className="text-sm text-amber-900">Gespeichertes Reasoning-Level „{savedReasoning.value}“ (Option {savedReasoning.option_id}) wird für dieses Modell aktuell nicht von T3 bestätigt. Wähle T3-Standard oder einen bestätigten Wert, um die gespeicherte Einstellung zu entfernen oder zu ersetzen.</p>
          )}
          {selectedProvider && models.length === 0 && omittedModels === 0 && <p role="status" className="text-sm text-muted-foreground">Für diese Providerinstanz meldet T3 keine Modelle. Suche nach Modell-ID oder Name.</p>}
        </>
      )}

      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" disabled={!connectionId || inventory.isFetching} onClick={() => void inventory.refetch()}>
          <RefreshCw className={inventory.isFetching ? 'animate-spin' : ''} />Provider neu laden
        </Button>
      </div>
    </section>
  )
}
