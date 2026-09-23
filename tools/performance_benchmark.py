from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from pathlib import Path
from typing import Callable, Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app import indexer


def measure(fn: Callable[[], Any], repeat: int) -> dict[str, Any]:
    samples = []
    value = None
    for _ in range(max(1, repeat)):
        start = time.perf_counter()
        value = fn()
        samples.append((time.perf_counter() - start) * 1000.0)
    return {
        "min_ms": round(min(samples), 3),
        "median_ms": round(statistics.median(samples), 3),
        "max_ms": round(max(samples), 3),
        "last_result_type": type(value).__name__,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Non-destructive Engineering Research Workbench performance benchmark")
    parser.add_argument("--query", default="research", help="FTS query used by the search benchmark")
    parser.add_argument("--repeat", type=int, default=3, help="number of warm measurements per operation")
    parser.add_argument("--rebuild", action="store_true", help="rebuild the disposable SQLite index before measuring")
    args = parser.parse_args()

    cold_start = time.perf_counter()
    state = indexer.rebuild() if args.rebuild else indexer.initialize(force=False)
    cold_ms = (time.perf_counter() - cold_start) * 1000.0

    first_page = indexer.list_docs(page=1, page_size=50, paged=True)
    sample_id = first_page["items"][0]["id"] if first_page.get("items") else ""

    results = {
        "index": state,
        "index_initialize_ms": round(cold_ms, 3),
        "documents_page_50": measure(lambda: indexer.list_docs(page=1, page_size=50, paged=True), args.repeat),
        "dashboard": measure(indexer.dashboard, args.repeat),
        "fts_search": measure(lambda: indexer.search_all(args.query, 50), args.repeat),
        "graph_overview_80": measure(lambda: indexer.graph_overview(80), args.repeat),
        "graph_initial_300": measure(lambda: indexer.graph(300), args.repeat),
        "project_records": measure(indexer.project_records, args.repeat),
    }
    if sample_id:
        results["open_document_by_id"] = measure(lambda: indexer.get_doc(sample_id), args.repeat)

    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
