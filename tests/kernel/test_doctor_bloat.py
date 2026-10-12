"""（常驻测试 · 原 .scratch/tmp 夹具，v261009.36 迁入 tests/）
正向验证：造一个「膨胀」的索引库（大量空闲页），doctor 必须报 warn 并给出维护建议。"""
import shutil
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from core import doctor  # noqa: E402

WS = ROOT / ".scratch" / "verify" / "ws_bloat"
DB = WS / "System" / "Cache" / "index.sqlite"
DB.parent.mkdir(parents=True, exist_ok=True)
if DB.exists():
    DB.unlink()
shutil.copy2(ROOT / "Workspace" / "System" / "Cache" / "index.sqlite", DB)

c = sqlite3.connect(str(DB))
c.execute("CREATE TABLE junk(x TEXT)")
c.executemany("INSERT INTO junk VALUES(?)", [("x" * 2000,) for _ in range(4000)])
c.commit()
c.execute("DROP TABLE junk")
c.commit()
c.close()

rep = doctor.run(WS, ROOT)
item = next((i for i in rep.items if i["check"] == "索引·体积与空闲页"), None)
ok = item is not None and item["level"] == "warn" and "maintain" in item["detail"]
print(("PASS " if ok else "FAIL ") + "膨胀库被识别为 warn：" + str(item))
raise SystemExit(0 if ok else 1)
