"""Semantic RAG acceptance: disposable data and local fake embeddings only."""
from __future__ import annotations

import copy
import json
import sys
import tempfile
import threading
import time
import unittest
from contextlib import ExitStack
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import agent_rag as rag, agent_memory as brain, agent_runtime as runtime, agent_tools, config, indexer, literature


class RagTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="erw-rag-test-")
        self.root = Path(self.tmp.name)
        self.stack = ExitStack()
        self.stack.enter_context(patch.object(brain, "ensure_workspace", return_value=self.root))
        self.stack.enter_context(patch.object(config, "CONFIG_DIR", self.root / "local-config"))
        self.docs = {
            "adapter": {"id": "adapter", "title": "Low rank adaptation", "kind": "note", "projects": ["Research"], "path": "Knowledge/Notes/adapter.md", "body": "Tune a small adapter instead of all parameters.\n" * 12},
            "control": {"id": "control", "title": "Weather observations", "kind": "journal", "body": "Observe rain and clouds."},
        }
        def get_doc(key):
            if key not in self.docs:
                raise FileNotFoundError(key)
            return copy.deepcopy(self.docs[key])
        self.stack.enter_context(patch.object(indexer, "get_doc", side_effect=get_doc))
        self.stack.enter_context(patch.object(indexer, "document_metadata", side_effect=lambda: list(self.docs.values())))
        self.stack.enter_context(patch.object(indexer, "retrieve_docs", side_effect=lambda query, kind=None, limit=8: {"items": [d for d in self.docs.values() if (not kind or d["kind"] == kind) and query.lower() in (d["title"] + d["body"]).lower()][:limit]}))
        self.stack.enter_context(patch.object(literature, "ensure_workspace", return_value=self.root))
        self.calls = []
        self.response_mode = "valid"
        test = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                test.calls.append((self.path, dict(self.headers), data))
                if test.response_mode == "http":
                    self.send_response(401)
                    self.end_headers()
                    self.wfile.write(b"provider-secret-body")
                    return
                if test.response_mode == "redirect":
                    self.send_response(302)
                    self.send_header("Location", "/leaked-credentials")
                    self.end_headers()
                    return
                rows = []
                for i, text in enumerate(data["input"]):
                    vector = [1., 0., 0.] if "adapter" in text or "省参数" in text else [0., 1., 0.]
                    if test.response_mode == "nan":
                        vector = [float("nan"), 0., 1.]
                    if test.response_mode == "zero":
                        vector = [0., 0., 0.]
                    if test.response_mode == "dimensions":
                        vector += [0.]
                    rows.append({"index": i if test.response_mode != "duplicate" else 0, "embedding": vector})
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"data": list(reversed(rows))}).encode())
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        rag.save_settings({"base_url": f"http://127.0.0.1:{self.server.server_port}/v1", "model": "fake-embedding", "api_key": "fake-private-key", "mode": "hybrid", "chunk_chars": 256, "overlap_chars": 32, "dimensions": 3})

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)
        self.stack.close()
        self.tmp.cleanup()

    def build(self):
        status = rag.build_index(background=False)
        self.assertEqual(status["job"]["state"], "completed", status["job"].get("error"))
        return status

    def test_configuration_keeps_key_private_preserves_blank_and_validates(self):
        public = rag.save_settings({"api_key": "", "model": "fake-embedding"})
        self.assertTrue(public["has_api_key"])
        self.assertNotIn("api_key", public)
        self.assertNotIn("fake-private-key", json.dumps(rag.status()))
        self.assertFalse((brain.root() / "agent-rag.json").exists())
        for invalid in ({"overlap_chars": 256}, {"dimensions": 9000}, {"base_url": "https://user:pass@example.invalid"}, {"mode": "unknown"}):
            with self.assertRaises(ValueError):
                rag.save_settings(invalid)
        self.assertTrue(rag.save_settings({"clear_api_key": True})["has_api_key"] is False)

    def test_connection_uses_saved_endpoint_auth_and_single_short_input(self):
        self.assertEqual(rag.test_connection()["dimensions"], 3)
        path, headers, data = self.calls[0]
        self.assertEqual(path, "/v1/embeddings")
        self.assertEqual(headers["Authorization"], "Bearer fake-private-key")
        self.assertEqual(data["dimensions"], 3)
        self.assertLess(len(data["input"][0]), 50)
        for mode in ("http", "redirect", "nan", "zero", "dimensions"):
            self.response_mode = mode
            with self.assertRaises(ValueError) as error:
                rag.test_connection()
            self.assertNotIn("provider-secret-body", str(error.exception))
            self.assertNotIn("fake-private-key", str(error.exception))
        self.assertFalse(any(path == "/leaked-credentials" for path, _, _ in self.calls))

    def test_build_semantic_lookup_provenance_kind_filter_and_tool_integration(self):
        result = self.build()
        self.assertGreater(result["index"]["chunks"], 2)
        self.assertEqual(result["index"]["dimensions"], 3)
        # Chinese question has no literal overlap with either English document.
        found = agent_tools.execute("kb_search", {"query": "省参数的方法"})
        self.assertTrue(found["ok"])
        item = found["items"][0]
        self.assertEqual(item["id"], "adapter")
        self.assertEqual(item["retrieval"], "semantic")
        source = item["source"]
        self.assertEqual(source["path"], "Knowledge/Notes/adapter.md")
        self.assertIn(self.docs["adapter"]["body"][source["offset"]:source["end_offset"]], item["excerpt"])
        calls = len(self.calls)
        self.assertEqual(rag.search("省参数的方法", kind="journal")["items"], [])
        self.assertEqual(len(self.calls), calls, "Repeated queries reuse a bounded query cache")
        runtime.save_settings({"rag_top_k": 1})
        self.assertLessEqual(rag.search("省参数的方法")["count"], 1)

    def test_incremental_build_reuses_vectors_and_removes_deleted_sources(self):
        first = self.build()
        count = len(self.calls)
        second = self.build()
        self.assertEqual(second["job"]["reused"], first["index"]["chunks"])
        self.assertEqual(len(self.calls), count)
        self.docs["adapter"]["body"] += "A new paragraph."
        changed = self.build()
        self.assertGreater(changed["job"]["reused"], 0)
        self.assertLess(changed["job"]["embedded"], changed["index"]["chunks"])
        del self.docs["adapter"]
        self.assertEqual(rag.search("省参数的方法")["items"], [])
        third = self.build()
        self.assertEqual(third["index"]["sources"], 1)
        self.assertEqual(third["index"]["chunks"], 1)

    def test_changed_sources_filtered_and_failed_or_cancelled_build_retains_index(self):
        first = self.build()["index"]
        self.docs["adapter"]["body"] += "Changed evidence"
        self.assertEqual(rag.search("省参数的方法")["items"], [])
        self.response_mode = "http"
        failed = rag.build_index(background=False)
        self.assertEqual(failed["job"]["state"], "failed")
        self.assertEqual(failed["index"]["generation"], first["generation"])
        self.response_mode = "valid"
        original = rag._embed
        def cancelling(texts, options):
            vectors = original(texts, options)
            rag.cancel_build()
            return vectors
        with patch.object(rag, "_embed", side_effect=cancelling):
            cancelled = rag.build_index(background=False)
        self.assertEqual(cancelled["job"]["state"], "cancelled")
        self.assertEqual(cancelled["index"]["generation"], first["generation"])
        with rag._connection() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(DISTINCT generation) FROM chunks").fetchone()[0], 1)

    def test_mode_and_switches_do_not_spend_embeddings_without_ready_index(self):
        rag.save_settings({"mode": "keyword"})
        self.assertEqual(rag.search("adapter")["mode"], "keyword")
        self.assertFalse(self.calls)
        rag.save_settings({"mode": "hybrid"})
        self.assertIn("warning", rag.search("adapter"))
        self.assertFalse(self.calls)
        rag.save_settings({"mode": "semantic"})
        with self.assertRaisesRegex(ValueError, "索引"):
            rag.search("adapter")
        self.build()
        rag.save_settings({"model": "another-model"})
        self.assertTrue(rag.status()["index"]["stale"])
        with self.assertRaisesRegex(ValueError, "索引"):
            rag.search("adapter")
        runtime.save_settings({"rag_enabled": False})
        count = len(self.calls)
        with self.assertRaisesRegex(ValueError, "关闭"):
            rag.search("adapter")
        self.assertEqual(len(self.calls), count)

    def test_pdf_index_keeps_page_citations_and_skips_empty_pages(self):
        rag.save_settings({"include_pdf": True, "mode": "semantic"})
        pdf = self.root / "paper.pdf"
        pdf.write_bytes(b"fake-pdf")
        pages = [SimpleNamespace(extract_text=lambda: ""), SimpleNamespace(extract_text=lambda: "An adapter reduces training parameters.")]
        item = {"id": "paper-1", "doc_id": "paper-note", "title": "PDF paper"}
        with patch.object(literature, "list_items", return_value={"items": [item], "total": 1}), patch.object(literature, "pdf_path", return_value=pdf), patch("pypdf.PdfReader", return_value=SimpleNamespace(pages=pages)):
            built = self.build()
            self.assertEqual(built["job"]["empty_sources"], 1)
            hits = rag.search("省参数的方法", kind="literature")["items"]
            self.assertEqual(hits[0]["source"]["page"], 2)
            self.assertEqual(hits[0]["source"]["paper_id"], "paper-1")
            pdf.write_bytes(b"modified-pdf")
            self.assertEqual(rag.search("省参数的方法", kind="literature")["items"], [])

    def test_real_http_routes_and_background_index_lifecycle(self):
        from server import Handler
        app_server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=app_server.serve_forever, daemon=True)
        thread.start()
        def request(path, body=None):
            data = json.dumps(body).encode() if body is not None else None
            with urlopen(Request(f"http://127.0.0.1:{app_server.server_port}/api/agent/rag" + path, data=data, headers={"Content-Type": "application/json"}), timeout=5) as response:
                return json.load(response)
        try:
            self.assertNotIn("api_key", request("")["settings"])
            self.assertEqual(request("/test", {})["dimensions"], 3)
            request("/settings", {"mode": "semantic"})
            request("/index", {})
            deadline = time.monotonic() + 4
            while time.monotonic() < deadline:
                status = request("")
                if status["job"]["state"] not in ("running", "cancelling"):
                    break
                time.sleep(.01)
            self.assertEqual(status["job"]["state"], "completed")
            self.assertEqual(request("/search", {"query": "省参数的方法"})["items"][0]["id"], "adapter")
        finally:
            app_server.shutdown()
            app_server.server_close()
            thread.join(2)


if __name__ == "__main__":
    unittest.main()
