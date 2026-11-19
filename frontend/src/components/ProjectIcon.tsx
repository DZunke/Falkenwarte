import { BookOpen, Code2, FolderKanban, Globe, Layers3, Shield, Star, Workflow, type LucideIcon } from 'lucide-react'

const icons: Record<string, LucideIcon> = {
  'folder-kanban': FolderKanban,
  'book-open': BookOpen,
  code: Code2,
  globe: Globe,
  layers: Layers3,
  shield: Shield,
  star: Star,
  workflow: Workflow,
}

export default function ProjectIcon({ iconKey, className = 'size-5' }: { iconKey: string; className?: string }) {
  const Icon = icons[iconKey] ?? FolderKanban
  return <Icon className={className} aria-hidden="true" />
}
