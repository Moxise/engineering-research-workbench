# Large Workspace Performance Architecture

This branch implements the large-workspace optimization described in the performance manual while preserving the project's Markdown-first design.

## Invariants

- Markdown and normal Workspace files remain the source of truth.
- `Workspace/System/Cache/index.sqlite` is disposable. Deleting it does not delete user data; the service rebuilds it from the Workspace.
- No third-party database/runtime dependency is added. The index uses Python's built-in `sqlite3` module and SQLite FTS5.
- Existing document/project/todo file formats remain readable outside the application.

## Data path

```text
Markdown / projects.json / todos.json / activity.jsonl
                    |
                    | incremental synchronization
                    v
       System/Cache/index.sqlite
                    |
        +-----------+-----------+----------------+
        |           |           |                |
      metadata     FTS5      graph_edges    aggregations
        |           |           |                |
        +-----------+-----------+----------------+
                    |
                    v
          bounded / paged APIs
                    |
                    v
       browser loads only visible data
```

## Indexed structures

`app/indexer.py` exposes the disposable index. The implementation is split into DB/schema, synchronization, query, graph and runtime/write modules. Main tables:

- `documents`: metadata, path, dates, excerpt and file signature.
- `document_projects`: document-to-project relations.
- `document_tags`: document-to-tag relations.
- `document_marks`: classification marks.
- `document_links`: parsed Wikilink tokens.
- `graph_edges`: materialized Wikilink/project/tag graph edges.
- `documents_fts`: FTS5 title/body/tag/project search index.
- `todos_index`: lightweight todo query table.
- `activity_daily`: incremental daily activity aggregation.

The index records file `mtime_ns` and size. A normal sync stats Markdown files and reparses only new or changed files; in-app document saves update the affected document immediately.

## API behavior

### Documents

`GET /api/docs` accepts existing filters plus `page`, `page_size`, and `paged=1`. Default page size is 50 and the hard API maximum is 200.

Paged response:

```json
{
  "items": [],
  "total": 3268,
  "page": 1,
  "page_size": 50,
  "pages": 66,
  "next_page": 2,
  "prev_page": null
}
```

`GET /api/docs/{id}` uses SQLite to resolve ID to path and only then reads that Markdown body.

### Search

Markdown document search is served from FTS5 rather than rereading every file. The browser performance layer aborts superseded global-search requests. TODO metadata is indexed; Agent chat keeps its previous transcript-search behavior.

### Dashboard

Counts, recent documents, project statistics, milestone windows and activity aggregates are queried from SQLite. Dashboard no longer reconstructs those values by repeatedly parsing the full Markdown collection.

### Knowledge graph

- `GET /api/graph/overview?limit=80`: bounded research-overview graph.
- `GET /api/graph?limit=300`: bounded full graph, hard maximum 500 document nodes.
- `GET /api/graph/neighborhood?root=...&depth=1|2`: indexed BFS; it no longer constructs the global graph first.

The graph response includes `meta.total_documents`, `meta.shown_documents` and `meta.truncated` so the UI can show the protection limit and progressively request more nodes.

### Workspace tree

- `GET /api/workspace/tree`: Workspace root plus direct children only.
- `GET /api/workspace/children?path=Knowledge`: one directory level on demand.
- `GET /api/workspace/tree?full=1`: compatibility/debug path for the old bounded recursive tree.

### Index maintenance

- `GET /api/system/index`: status and counts.
- `POST /api/system/index/rebuild`: delete and fully rebuild the disposable index.
- Workspace UI exposes the same rebuild action.

## Workspace migration behavior

`System/schema.json` records the Workspace/index schema. The expensive legacy project-ID migration remains available, but startup only invokes it when the schema/registry indicates migration is required. Manual Workspace migration and system reload are explicit full-repair paths and rebuild the index afterward.

## Browser protection

`web/v260922-performance.js` is loaded before the existing application script and provides:

- 50-row server-side document pages (milestones use a bounded 200-row page for timeline usability);
- previous/next page controls;
- aborting superseded global-search requests;
- 80-node research-overview graph;
- 300-node initial graph with progressive loading up to a hard 500-node browser cap;
- lazy Workspace directory expansion;
- index status/rebuild UI.

This bounds the existing `state.docs` and `state.graph` data without requiring a risky full rewrite of `web/app.js` in the same performance branch.

## Validation

Run the existing self-check first, then the non-destructive benchmark:

```bash
python tools/self_check.py
python tools/performance_benchmark.py
python tools/performance_benchmark.py --query transformer --repeat 5
```

For a cold-index measurement:

```bash
python tools/performance_benchmark.py --rebuild --repeat 3
```

The benchmark does not create or modify research documents. `--rebuild` only deletes/recreates the disposable SQLite cache.

## Intended scale

The design follows the performance manual's target class of 10,000+ Markdown records, 100+ projects, 10,000+ todos and a global graph with 10,000+ document nodes while keeping a browser-visible graph in the low hundreds. Actual latency depends on disk, CPU, Markdown body size and OS file-cache state.
