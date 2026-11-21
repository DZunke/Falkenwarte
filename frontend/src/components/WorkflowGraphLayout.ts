import { Graph, layout, type EdgeLabel, type GraphLabel, type NodeLabel, type Point } from '@dagrejs/dagre'

type Direction = 'horizontal' | 'vertical'
type Connection = { from_stage_id: string; to_stage_id: string }
type StageBox = { x: number; y: number; width: number; height: number }

type Route = {
  kind: 'forward' | 'return' | 'skip'
  lane: number
  labelMaxWidth: number
  waypoints?: Point[]
}

export function workflowLayout(stageIds: readonly string[], transitions: readonly Connection[], direction: Direction, containerWidth: number) {
  const horizontal = direction === 'horizontal'
  const count = Math.max(1, stageIds.length)
  const gap = Math.max(120, Math.min(230, (containerWidth - 40 - count * 205) / Math.max(1, count - 1)))
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
    edges.set(i, { kind, lane: 0, labelMaxWidth: Math.max(112, gap - 8) })
  })

  for (const indices of groups.values()) {
    indices.forEach((i, offset) => {
      const edge = edges.get(i)!
      edge.lane = edge.kind === 'return' ? offset : offset - (indices.length - 1) / 2
    })
  }

  const linearWidth = Math.max(160, Math.min(260, (containerWidth - 40 - (count - 1) * gap) / count))
  const desktopWidth = linearWidth
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
  const rankByStage = new Map(stageIds.map((id) => [id, 0]))
  const orderedForwardRoutes = transitions
    .map((transition, edgeIndex) => ({
      transition,
      edgeIndex,
      from: index.get(transition.from_stage_id),
      to: index.get(transition.to_stage_id),
    }))
    .filter((route): route is { transition: Connection; edgeIndex: number; from: number; to: number } =>
      route.from !== undefined && route.to !== undefined && route.to > route.from)
    .sort((left, right) => left.from - right.from || left.to - right.to)

  for (const route of orderedForwardRoutes) {
    const sourceRank = rankByStage.get(route.transition.from_stage_id) ?? 0
    rankByStage.set(route.transition.to_stage_id, Math.max(rankByStage.get(route.transition.to_stage_id) ?? 0, sourceRank + 1))
  }
  const rankCount = Math.max(0, ...rankByStage.values()) + 1
  const horizontalRankGap = Math.max(120, Math.min(144, containerWidth / Math.max(1, rankCount * 1.8)))
  const horizontalWidthBudget = Math.max(1, containerWidth - 64)
  const verticalLaneGap = 12
  const verticalWidthBudget = Math.max(1, containerWidth - 64)
  const verticalRouteChipHeight = 32
  const verticalRouteLabelGap = 8
  const verticalNodeClearance = 16
  const verticalCurveReserve = 8
  const minimumVerticalBranchRankGap = 2 * verticalRouteChipHeight
    + verticalRouteLabelGap
    + 2 * verticalNodeClearance
    + verticalCurveReserve
  const horizontalNodeWidth = Math.max(136, Math.min(244, (horizontalWidthBudget - (rankCount - 1) * horizontalRankGap) / rankCount))
  const verticalNodeWidth = Math.max(180, Math.min(260, verticalWidthBudget))
  const branchWidth = horizontal ? horizontalNodeWidth : verticalNodeWidth
  const branchLabelMaxWidth = horizontal ? Math.max(112, horizontalRankGap - 8) : Math.max(112, Math.min(220, containerWidth - 48))

  for (const route of edges.values()) route.labelMaxWidth = branchLabelMaxWidth

  const graph = new Graph<GraphLabel, NodeLabel, EdgeLabel>({ multigraph: true })
  // A dense vertical rank gap can hold two 32px route pills, their gap, node margins, and curve slack.
  const rankSep = horizontal ? horizontalRankGap : minimumVerticalBranchRankGap
  graph.setGraph({ rankdir: horizontal ? 'LR' : 'TB', ranksep: rankSep, nodesep: horizontal ? 56 : verticalLaneGap, edgesep: 32, marginx: 32, marginy: 52 })
  stageIds.forEach(id => graph.setNode(id, { width: branchWidth, height }))
  if (!horizontal) {
    // Keep mobile reading order vertical even when several branches share a rank.
    for (let i = 0; i < stageIds.length - 1; i++) {
      graph.setEdge(stageIds[i], stageIds[i + 1], { weight: 100 }, `sequence-${i}`)
    }
  }
  for (const [i, route] of edges) {
    if (route.kind === 'return') continue
    const transition = transitions[i]
    graph.setEdge(transition.from_stage_id, transition.to_stage_id, { weight: 1 }, String(i))
  }
  layout(graph)
  stageIds.forEach(id => {
    const box = graph.node(id)
    nodes.set(id, { x: box.x! - branchWidth / 2, y: box.y! - height / 2, width: branchWidth, height })
  })
  for (const link of graph.edges()) {
    if (!link.name || !/^\d+$/.test(link.name)) continue
    const points = graph.edge(link).points
    if (points) edges.get(Number(link.name))!.waypoints = points.slice(1, -1)
  }
  return { nodes, edges, width: graph.graph().width ?? 0, height: graph.graph().height ?? 0 }
}
