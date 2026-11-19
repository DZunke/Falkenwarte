import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSlug from 'rehype-slug'
import { BookOpen, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatError } from '@/lib/api'

type Document = { path: string; sourcePath: string; title: string; headings: { depth: number; text: string; id?: string }[]; markdown?: string; searchText?: string }
type Manifest = { documents: Document[] }

export default function DocsView({ path, navigate }: { path: string; navigate: (path: string) => void }) {
  const [search, setSearch] = useState('')
  const manifestQuery = useQuery({
    queryKey: ['docs-manifest'],
    queryFn: async () => {
      const response = await fetch('/docs/index.json', { credentials: 'same-origin' })
      if (!response.ok) throw new Error(`Dokumentation konnte nicht geladen werden (${response.status}).`)
      return response.json() as Promise<Manifest>
    },
    staleTime: 60_000,
  })
  const documents = manifestQuery.data?.documents ?? []
  const selected = documents.find((document) => decodeURIComponent(path.replace(/^docs\/?/, '')) === document.path.replace(/^docs\/?/, '')) ?? documents.find((document) => document.path === 'README.md') ?? documents[0]
  const query = search.trim().toLocaleLowerCase()
  const results = useMemo(() => documents.filter((document) => !query || `${document.title} ${document.searchText ?? ''}`.toLocaleLowerCase().includes(query)), [documents, query])

  if (manifestQuery.isPending) return <div className="grid gap-6 lg:grid-cols-[250px_1fr]"><Skeleton className="h-[70vh]" /><Skeleton className="h-[70vh]" /></div>
  if (manifestQuery.isError) return <Card><CardContent className="p-6"><h1 className="text-lg font-semibold">Dokumentation nicht verfügbar</h1><p className="mt-2 text-sm text-muted-foreground">{formatError(manifestQuery.error)}</p></CardContent></Card>
  if (!selected) return <Card><CardContent className="flex min-h-64 flex-col items-center justify-center p-8 text-center"><BookOpen className="mb-3 size-8 text-muted-foreground" /><h1 className="text-lg font-semibold">Noch keine Dokumente</h1><p className="mt-2 text-sm text-muted-foreground">Die statische Produktdokumentation wird beim Anwendungsbuild bereitgestellt.</p></CardContent></Card>

  const markdown = selected.markdown ?? ''
  return (
    <div className="grid gap-6 lg:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[270px_minmax(0,1fr)_190px]">
      <aside className="max-h-[calc(100vh-145px)] overflow-y-auto rounded-xl border bg-card p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><BookOpen className="size-4 text-primary" />Produktwissen</h2>
        <div className="relative mb-4"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input aria-label="Dokumentation durchsuchen" placeholder="Dokumente suchen…" value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 pl-8" /></div>
        <nav aria-label="Dokumente" className="space-y-1">{results.map((document) => <button key={document.path} onClick={() => navigate(`/docs/${encodeURIComponent(document.path.replace(/^docs\/?/, ''))}`)} className={`block w-full rounded-md px-2.5 py-2 text-left text-sm ${document.path === selected.path ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>{document.title}</button>)}{results.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">Keine passenden Dokumente.</p>}</nav>
      </aside>
      <article className="min-w-0 rounded-xl border bg-card px-6 py-7 sm:px-9 sm:py-9">
        <div className="mb-7 border-b pb-5"><p className="text-xs font-medium uppercase tracking-wide text-primary">Falkenwarte Dokumentation</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">{selected.title}</h1></div>
        <div className="prose-falkenwarte">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeSlug]}
            components={{
              a({ href, children }) {
                if (!href) return <>{children}</>
                if (href.startsWith('#')) return <a href={href} onClick={(event) => { event.preventDefault(); document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>{children}</a>
                const local = href.startsWith('/') || href.startsWith('./') || href.startsWith('../')
                const resolved = local ? new URL(href, `https://falkenwarte.local${selected.sourcePath}`).pathname : href
                const doc = documents.find((item) => item.sourcePath === resolved || item.path.endsWith(resolved.replace('/docs/content/', '')))
                if (doc) return <a href={`#/docs/${encodeURIComponent(doc.path.replace(/^docs\/?/, ''))}`} onClick={(event) => { event.preventDefault(); navigate(`/docs/${encodeURIComponent(doc.path.replace(/^docs\/?/, ''))}`) }}>{children}</a>
                return <a href={href} target={local ? undefined : '_blank'} rel={local ? undefined : 'noopener noreferrer'}>{children}</a>
              },
              img({ src, alt }) {
                if (!src) return null
                const resolved = new URL(src, `https://falkenwarte.local${selected.sourcePath}`).pathname
                return <img src={resolved} alt={alt ?? ''} loading="lazy" />
              },
            }}
          >{markdown}</ReactMarkdown>
        </div>
      </article>
      <aside className="hidden xl:block"><div className="sticky top-24 rounded-xl border bg-card p-4"><h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Auf dieser Seite</h2><nav className="space-y-2">{selected.headings.filter((heading) => heading.depth > 1).map((heading, index) => <a key={`${heading.text}-${index}`} href={`#${heading.id ?? ''}`} onClick={(event) => { event.preventDefault(); if (heading.id) document.getElementById(heading.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }} className="block text-xs leading-5 text-muted-foreground hover:text-primary" style={{ paddingLeft: `${Math.max(0, heading.depth - 2) * 10}px` }}>{heading.text}</a>)}</nav></div></aside>
    </div>
  )
}
