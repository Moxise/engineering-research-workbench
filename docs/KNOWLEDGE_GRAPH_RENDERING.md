# Knowledge Graph Rendering Optimization

Branch: `perf/knowledge-graph-rendering`
Base: `perf/sqlite-index-lazy-loading`

## Scope

This branch changes the knowledge-graph presentation and interaction layer while preserving the existing network/many-to-many data model. Markdown remains the source of truth and no Workspace document schema is changed.

## Implemented

- Force-directed layout using graph edges instead of index-based spiral placement.
- Lightweight label-propagation community hints used only for layout attraction; communities do not create parent/child graph nodes.
- Layout signature and in-memory/sessionStorage cache. Camera movement, selection and redraw do not recompute the layout.
- Shared 2D/3D graph engine. Search, focus, adjacency and LOD logic are common; only projection differs.
- Adjacency map and degree index built once per filtered graph.
- Search index containing node id, label, kind, tags, projects and updated time.
- Search suggestions with exact/prefix/contains/tag/project priority.
- Empty-query recent-edited list.
- Keyboard Arrow Up/Down, Enter and Escape support.
- Search selection performs camera focus, node selection and Markdown preview.
- Focus + Context rendering for direct relations and two-hop relations.
- Semantic label LOD based on zoom, graph size, node kind and degree.
- Label collision detection with selected/search/direct-neighbor priority.
- Edge LOD and low-opacity context rendering.
- Viewport culling for nodes and labels, and endpoint-based edge culling.
- Projection calculated once per node per frame and reused by edge, node, label, hit-test and 3D z-sort paths.
- Cached text measurement for labels.
- requestAnimationFrame render coalescing for pointer and wheel interaction.
- Existing kind/relation filters, Markdown preview and graph bundle API remain available.

## Current scale guard

The base performance branch currently protects `/api/graph` with its existing browser-side/server-side graph limits. This rendering branch intentionally does not remove that data-safety guard yet. The renderer itself uses sampled repulsion rather than all-pairs repulsion so the same engine can be extended toward the 500–2000-node range without changing interaction semantics.

For workspaces above the current graph payload limit, the next server-side step should be graph chunking/neighborhood fetch rather than returning an unbounded graph in one response.

## LOD behavior

- Far zoom: labels are restricted mostly to high-degree/project/search/selected nodes and edges are aggressively reduced.
- Medium zoom: project/high-degree/tag context becomes visible.
- Near zoom: more ordinary knowledge labels and relations are rendered.
- Selected node: selected + one-hop relations are fully emphasized; two-hop context is optionally enabled; unrelated content remains as a faint global context.

## Manual validation checklist

1. Open Knowledge Graph with 100+, 300+ and 500-node datasets.
2. Verify layout is topology-driven rather than circular/spiral.
3. Zoom out and confirm ordinary labels disappear without a text wall.
4. Zoom in and confirm additional labels gradually appear.
5. Select a dense node and compare Direct / Two-level / Full view.
6. Search by title, tag and project; test keyboard navigation and Enter.
7. Focus the empty search box and verify recently edited entries.
8. Switch between 2D and 3D and verify the same focused node remains logically selected.
9. Drag, zoom and rotate continuously while watching browser CPU and frame responsiveness.
10. Open Markdown preview, including notes containing images.
11. Toggle graph node/relation filters and verify layout/search indexes refresh.
12. Generate related Markdown from a selected node.

## Future >2000-node path

When profiling shows the current Canvas 2D engine is no longer enough, preserve the graph-engine public behavior and move only expensive implementation pieces to Web Worker / OffscreenCanvas or WebGL. The search/focus/selection model should remain unchanged.
