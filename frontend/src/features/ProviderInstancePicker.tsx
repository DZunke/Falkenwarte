import { useEffect, useId, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { api, formatError, request } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export type ProviderSelection = {
  provider_instance_id: string
  model?: string
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
  const selectedProvider = providers.find((provider) => provider.provider_instance_id === value?.provider_instance_id)
  const models = selectedProvider?.models ?? []
  const omittedModels = selectedProvider?.omitted_models ?? 0
  const matchingModel = models.find((model) => model.id === value?.model)
  const selectedModelId = matchingModel?.id ?? (!value?.model && models.length === 1 && omittedModels === 0 ? models[0].id : '')
  const selectedModel = models.find((model) => model.id === selectedModelId)
  const ready = Boolean(inventory.isSuccess && !inventory.isFetching && selectedProvider?.available && selectedModel)

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
          {providers.length > 0 ? (
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
                  {providers.map((provider) => (
                    <SelectItem key={provider.provider_instance_id} className="whitespace-normal break-words" value={provider.provider_instance_id} disabled={!provider.available}>
                      {provider.display_name || 'Unbenannte Providerinstanz'} · {provider.provider_instance_id}{provider.available ? '' : ' · nicht verfügbar'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Die T3-Instanz-ID unterscheidet auch mehrere gleichnamige Provider.</p>
            </div>
          ) : (
            <p role="status" className="text-sm text-muted-foreground">{searchTerm ? 'T3 meldet keine Provider oder Modelle für diese Suche.' : 'T3 meldet keine Providerinstanzen für diese Verbindung.'}</p>
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

          {selectedProvider && !selectedProvider.available && <p role="status" className="text-sm text-muted-foreground">Diese Providerinstanz ist laut T3 derzeit nicht verfügbar.</p>}
          {value && !selectedProvider && <p role="status" className="text-sm text-muted-foreground">Die gespeicherte Providerinstanz {value.provider_instance_id} ist in dieser T3-Antwort nicht enthalten. Setze die Suche zurück oder wähle eine verfügbare Instanz.</p>}
          {selectedProvider && omittedModels > 0 && <p role="status" className="text-xs text-muted-foreground">T3 zeigt für diese Instanz nur einen Teil der Modelle. Suche nach Modell-ID oder Name; das Kurzlistenmodell wird nicht automatisch ausgewählt.</p>}
          {selectedProvider && value?.model && !matchingModel && <p role="status" className="text-sm text-muted-foreground">Das gespeicherte Modell {value.model} ist in der aktuellen T3-Auswahl nicht enthalten. Suche danach oder wähle bewusst ein anderes Modell, bevor du speicherst.</p>}
          {selectedProvider && models.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor={modelFieldId}>Modell aus T3</Label>
              <Select value={selectedModelId} disabled={inventory.isFetching || !selectedProvider.available} onValueChange={(modelId) => onChange({ provider_instance_id: selectedProvider.provider_instance_id, model: modelId })}>
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
