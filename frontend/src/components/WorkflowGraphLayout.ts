import { Graph, layout, type EdgeLabel, type GraphLabel, type NodeLabel, type Point } from '@dagrejs/dagre'

type Direction = 'horizontal' | 'vertical'
type Connection = { from_stage_id: string; to_stage_id: string }
type StageBox = { x: number; y: number; width: number; height: number }

type Route = {
  kind: 'forward' | 'return' | 'skip'
  lane: number
  waypoints?: Point[]
}

export function workflowLayout(stageIds: readonly string[], transitions: readonly Connection[], direction: Direction, containerWidth: number) {
  const horizontal = direction === 'horizontal'
  const count = Math.max(1, stageIds.length)
  const gap = Math.max(76, Math.min(230, (containerWidth - 40 - count * 205) / Math.max(1, count - 1)))
  const index = new Map(stageIds.map((id, i) => [id, i]))
  const edges = new Map<number, Route>()
  const groups = new Map<string, number[]>()
  let branched = false

  transitions.forEach((transition, i) => {
    const from = index.get(transition.from_stage_id)
    const to = index.get(transition.to_stage_id)
    if (from === undefined || to === undefined) return
    const kind = to <= from ? 'return' : to > from + 1 ? 'skip' : 'forward'
    if (kind === 'skip') branched = true
    const pair = `${from}:${to}`
    const group = groups.get(pair) ?? []
    group.push(i)
    groups.set(pair, group)
    edges.set(i, { kind, lane: 0 })
  })

  for (const indices of groups.values()) {
    indices.forEach((i, offset) => {
      const edge = edges.get(i)!
      edge.lane = edge.kind === 'return' ? offset : offset - (indices.length - 1) / 2
    })
  }

  const linearWidth = Math.max(160, Math.min(260, (containerWidth - 40 - (count - 1) * gap) / count))
  const desktopWidth = branched ? 244 : linearWidth
  const width = horizontal ? desktopWidth : Math.max(220, Math.min(300, containerWidth - 96))
  const height = 164
  const nodes = new Map<string, StageBox>()
  if (!branched) {
    const rowWidth = count * width + (count - 1) * gap
    stageIds.forEach((id, i) => nodes.set(id, {
      x: horizontal ? Math.max(20, (containerWidth - rowWidth) / 2) + i * (width + gap) : Math.max(26, (containerWidth - width) / 2),
      y: horizontal ? 148 : 28 + i * 250,
      width, height,
    }))
    return { nodes, edges, width: horizontal ? rowWidth : width, height: horizontal ? height : (count - 1) * 250 + height }
  }

  // Only forward routes determine the reading order. Rework must not move an earlier phase behind its reviewer.
  const graph = new Graph<GraphLabel, NodeLabel, EdgeLabel>({ multigraph: true })
  graph.setGraph({ rankdir: horizontal ? 'LR' : 'TB', ranksep: horizontal ? 180 : 112, nodesep: 85, edgesep: 44, marginx: 32, marginy: 52 })
  stageIds.forEach(id => graph.setNode(id, { width, height }))
  for (const [i, route] of edges) {
    if (route.kind === 'return') continue
    const transition = transitions[i]
    graph.setEdge(transition.from_stage_id, transition.to_stage_id, {}, String(i))
  }
  layout(graph)
  stageIds.forEach(id => {
    const box = graph.node(id)
    nodes.set(id, { x: box.x! - width / 2, y: box.y! - height / 2, width, height })
  })
  for (const link of graph.edges()) {
    const points = graph.edge(link).points
    if (points) edges.get(Number(link.name))!.waypoints = points.slice(1, -1)
  }
  return { nodes, edges, width: graph.graph().width ?? 0, height: graph.graph().height ?? 0 }
}
