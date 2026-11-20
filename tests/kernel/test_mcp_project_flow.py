import json
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from app import external_access, project_flow, projects
from mcp.bridge import Workbench
from mcp.server import dispatch


class ProjectFlowMcpTests(unittest.TestCase):
    def setUp(self):
        verify = ROOT / ".scratch" / "verify"
        verify.mkdir(parents=True, exist_ok=True)
        workspace = Path(self.enterContext(TemporaryDirectory(dir=verify)))
        self.flow_path = workspace / "Projects" / "画布测试" / "project-flow.json"
        self.access_path = workspace / "external-access.json"
        self.project = {"id": "proj_flow", "name": "画布测试"}
        child = {"id": "proj_child", "name": "子项目", "parent_id": self.project["id"]}
        self.enterContext(patch.object(external_access, "CONFIG_PATH", self.access_path))
        self.enterContext(patch.object(projects, "ensure_workspace", return_value=workspace))
        self.enterContext(patch.object(projects, "_load_registry", return_value=[self.project, child]))
        self.enterContext(patch.object(project_flow.indexer, "project_flow_evidence", return_value=([], [], [])))
        self.workbench = Workbench()
        self.workbench._mod = SimpleNamespace(project_flow=project_flow)
        self.enterContext(patch.object(self.workbench, "list_projects", return_value=[{
            "name": self.project["name"], "project_id": self.project["id"],
        }]))

    def call(self, name, **arguments):
        return dispatch(self.workbench, {"method": "tools/call", "params": {"name": name, "arguments": arguments}})

    def test_guideline_is_discoverable_and_current(self):
        uri = "workbench://rules/agent-guideline"
        guide = "## 项目工作流程图（工程画布）"
        self.workbench._mod.config = SimpleNamespace(reload_writing_rules=lambda: guide)
        resources = dispatch(self.workbench, {"method": "resources/list"})["resources"]
        self.assertTrue(any(item["uri"] == uri for item in resources))
        for text in (guide, guide + "\n参考线与防重叠"):
            guide = text
            self.assertEqual(self.call("ws_agent_guideline")["content"][0]["text"], text)
            result = dispatch(self.workbench, {"method": "resources/read", "params": {"uri": uri}})
            self.assertEqual(result["contents"][0]["text"], text)

    def test_canvas_write_permission_grid_overlap_and_revision(self):
        flow = json.loads(self.call("ws_get_project_flow", project=self.project["name"])["content"][0]["text"])
        self.assertTrue(flow["relations"]["projects"][0]["child"])
        self.assertEqual(flow["layout"]["grid_size"], 16)
        step = {"id": "step", "kind": "step", "title": "新阶段", "x": 263, "y": 97}
        payload = dict(project=self.project["id"], revision=flow["revision"], nodes=[*flow["nodes"], step],
                       edges=[{"id": "next", "source": "root", "target": "step"}], relation_scope="hierarchy")
        denied = self.call("ws_save_project_flow", **payload)
        self.assertTrue(denied["isError"])
        self.assertIn("未授权", denied["content"][0]["text"])
        self.assertFalse(self.flow_path.exists())
        external_access.save({"mcp_write": True})
        saved = json.loads(self.call("ws_save_project_flow", **payload)["content"][0]["text"])
        self.assertEqual((saved["nodes"][1]["x"], saved["nodes"][1]["y"]), (256, 96))
        stale = self.call("ws_save_project_flow", **payload)
        self.assertTrue(stale["isError"])
        self.assertIn("已在其他窗口更新", stale["content"][0]["text"])
        payload.update(revision=saved["revision"], nodes=saved["nodes"])
        payload.pop("relation_scope")
        step = payload["nodes"][1]
        step["x"] = 80
        overlap = self.call("ws_save_project_flow", **payload)
        self.assertTrue(overlap["isError"])
        self.assertIn("卡片重叠", overlap["content"][0]["text"])
        self.assertEqual(project_flow.get(self.project["id"])["revision"], saved["revision"])
        step["x"] = 320
        moved = json.loads(self.call("ws_save_project_flow", **payload)["content"][0]["text"])
        self.assertEqual(moved["relation_scope"], "hierarchy")
        self.assertEqual(moved["edges"], saved["edges"])


if __name__ == "__main__":
    unittest.main(argv=sys.argv[:1])
