import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatError } from '@/lib/api'

type Heading = { depth: number; text: string; id?: string }
type Document = {
  path: string
  section: string
  title: string
  headings: Heading[]
  searchText?: string
}
type Manifest = { revision?: string; documents: Document[] }
type PendingAnchor = { path: string; id: string }

const sectionOrder = ['Start', 'Benutzerhandbuch', 'Betrieb', 'Entwicklung', 'Architekturentscheidungen', 'Fachmodell']
const pageUrl = (path: string) => path === 'README.md' ? '/docs/index.html' : `/docs/${path.slice(0, -3)}.html`

export default function DocsView({ path, navigate }: { path: string; navigate: (path: string) => void }) {
  const [search, setSearch] = useState('')
  const [pendingAnchor, setPendingAnchor] = useState<PendingAnchor | null>(null)
  const manifestQuery = useQuery({
    queryKey: ['docs-manifest'],
    queryFn: async () => {
      const response = await fetch('/docs/index.json', { credentials: 'same-origin' })
      if (!response.ok) throw new Error(`Dokumentation konnte nicht geladen werden (${response.status}).`)
      return response.json() as Promise<Manifest>
    },
    staleTime: 60_000,
  })
  const manifest = manifestQuery.data
  const documents = manifest?.documents ?? []
  const selected = documents.find((document) => decodeURIComponent(path.replace(/^docs\/?/, '')) === document.path.replace(/^docs\/?/, ''))
    ?? documents.find((document) => document.path === 'README.md')
    ?? documents[0]
  const query = search.trim().toLocaleLowerCase()
  const results = useMemo(
    () => documents.filter((document) => !query || `${document.title} ${document.searchText ?? ''}`.toLocaleLowerCase().includes(query)),
    [documents, query],
  )
  const groups = useMemo(() => sectionOrder.map((section) => ({
    section,
    documents: results.filter((document) => document.section === section),
  })).filter((group) => group.documents.length > 0), [results])
  const articleQuery = useQuery({
    queryKey: ['docs-rendered-page', selected?.path],
    enabled: Boolean(selected),
    queryFn: async () => {
      if (!selected) throw new Error('Keine Handbuchseite ausgewählt.')
      const response = await fetch(pageUrl(selected.path), { credentials: 'same-origin' })
      if (!response.ok) throw new Error(`Handbuchseite konnte nicht geladen werden (${response.status}).`)
      const source = await response.text()
      const page = new DOMParser().parseFromString(source, 'text/html')
      const article = page.querySelector('main article')
      if (!article) throw new Error('Die gerenderte Handbuchseite enthält keinen Artikel.')
      return article.innerHTML
    },
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!pendingAnchor || pendingAnchor.path !== selected?.path || articleQuery.isPending) return
    const target = document.getElementById(pendingAnchor.id)
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setPendingAnchor(null)
  }, [articleQuery.data, articleQuery.isPending, pendingAnchor, selected?.path])

  if (manifestQuery.isPending) return <div className="grid gap-6 lg:grid-cols-[250px_1fr]"><Skeleton className="h-[70vh]" /><Skeleton className="h-[70vh]" /></div>
  if (manifestQuery.isError) return <Card><CardContent className="p-6"><h1 className="text-lg font-semibold">Dokumentation nicht verfügbar</h1><p className="mt-2 text-sm text-muted-foreground">{formatError(manifestQuery.error)}</p></CardContent></Card>
  if (!selected) return <Card><CardContent className="flex min-h-64 flex-col items-center justify-center p-8 text-center"><BookOpen className="mb-3 size-8 text-muted-foreground" /><h1 className="text-lg font-semibold">Noch keine Dokumente</h1><p className="mt-2 text-sm text-muted-foreground">Die Handbuchseiten werden beim Anwendungsbuild bereitgestellt.</p></CardContent></Card>

  const selectDocument = (event: MouseEvent<HTMLButtonElement>, document: Document) => {
    event.currentTarget.closest('details')?.removeAttribute('open')
    navigate(`/docs/${encodeURIComponent(document.path)}`)
  }
  const renderNavigation = () => (
    <>
      <div className="relative mb-4"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input aria-label="Dokumentation durchsuchen" placeholder="Dokumente suchen…" value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 pl-8" /></div>
      <nav aria-label="Dokumente" className="space-y-4">
        {groups.map((group) => (
          <section key={group.section}>
            <h3 className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.section}</h3>
            <div className="space-y-1">
              {group.documents.map((item) => (
                <button
                  key={item.path}
                  aria-current={item.path === selected.path ? 'page' : undefined}
                  onClick={(event) => selectDocument(event, item)}
                  className={`block w-full rounded-md px-2.5 py-2 text-left text-sm ${item.path === selected.path ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                >
                  {item.title}
                </button>
              ))}
            </div>
          </section>
        ))}
        {results.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">Keine passenden Dokumente.</p>}
      </nav>
    </>
  )
  const handleArticleClick = (event: MouseEvent<HTMLDivElement>) => {
    const clicked = event.target
    if (!(clicked instanceof Element)) return
    const link = clicked.closest('a[href]')
    const href = link?.getAttribute('href')
    if (!href) return
    if (href.startsWith('#')) {
      event.preventDefault()
      document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }

    const target = new URL(href, window.location.href)
    if (target.origin !== window.location.origin) return
    const targetDocument = documents.find((document) => pageUrl(document.path) === target.pathname)
    if (!targetDocument) return

    event.preventDefault()
    if (target.hash) {
      const id = decodeURIComponent(target.hash.slice(1))
      if (targetDocument.path === selected.path) {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } else {
        setPendingAnchor({ path: targetDocument.path, id })
      }
    }
    if (targetDocument.path !== selected.path) navigate(`/docs/${encodeURIComponent(targetDocument.path)}`)
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[270px_minmax(0,1fr)_190px]">
      <aside className="hidden max-h-[calc(100vh-145px)] overflow-y-auto rounded-xl border bg-card p-4 lg:block">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><BookOpen className="size-4 text-primary" />Handbuch</h2>
        {renderNavigation()}
      </aside>
      <details className="rounded-xl border bg-card p-4 lg:hidden">
        <summary className="cursor-pointer text-sm font-semibold">Handbuch durchsuchen</summary>
        <div className="mt-4 max-h-[55vh] overflow-y-auto">{renderNavigation()}</div>
      </details>
      <article className="min-w-0 rounded-xl border bg-card px-6 py-7 sm:px-9 sm:py-9">
        {articleQuery.isPending && <Skeleton className="h-[70vh]" />}
        {articleQuery.isError && <p role="alert" className="text-sm text-destructive">{formatError(articleQuery.error)}</p>}
        {articleQuery.data && <div className="prose-falkenwarte" onClick={handleArticleClick} dangerouslySetInnerHTML={{ __html: articleQuery.data }} />}
      </article>
      <aside className="hidden xl:block"><div className="sticky top-24 rounded-xl border bg-card p-4"><h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Auf dieser Seite</h2><nav aria-label="Auf dieser Seite" className="space-y-2">{selected.headings.filter((heading) => heading.depth > 1).map((heading, index) => <a key={`${heading.text}-${index}`} href={`#${heading.id ?? ''}`} onClick={(event) => { event.preventDefault(); if (heading.id) document.getElementById(heading.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }} className="block text-xs leading-5 text-muted-foreground hover:text-primary" style={{ paddingLeft: `${Math.max(0, heading.depth - 2) * 10}px` }}>{heading.text}</a>)}</nav></div></aside>
    </div>
  )
}
