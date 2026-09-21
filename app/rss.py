from __future__ import annotations

import html
import json
import re
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from urllib.parse import quote
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .config import get_rss
from .workspace import ensure_workspace

CACHE_TTL = 15 * 60
MAX_BYTES = 8 * 1024 * 1024


def _cache_path() -> Path:
    return ensure_workspace() / "System" / "Cache" / "rss_cache.json"

def clear_cache() -> None:
    try:
        _cache_path().unlink(missing_ok=True)
    except OSError:
        pass

def _strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text or "")
    return re.sub(r"\s+", " ", html.unescape(text)).strip()

def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()

def _child_text(node, names: set[str]) -> str:
    for child in list(node):
        if _local_name(child.tag) in names and child.text:
            return child.text.strip()
    return ""

def _parse_feed(xml: bytes, source_name: str, limit: int) -> list[dict]:
    root = ET.fromstring(xml)
    items: list[dict] = []
    # RSS / RDF items
    for item in [n for n in root.iter() if _local_name(n.tag) == "item"][:limit]:
        link = _child_text(item, {"link"})
        items.append({
            "title": _child_text(item, {"title"}),
            "url": link,
            "published": _child_text(item, {"pubdate", "date", "published", "updated"}),
            "summary": _strip_html(_child_text(item, {"description", "summary", "content", "encoded"}))[:800],
            "source": source_name,
        })
    if items:
        return items
    # Atom
    for entry in [n for n in root.iter() if _local_name(n.tag) == "entry"][:limit]:
        link = ""
        for child in list(entry):
            if _local_name(child.tag) == "link":
                href = child.attrib.get("href") or ""
                rel = child.attrib.get("rel") or "alternate"
                if href and (rel == "alternate" or not link):
                    link = href
        items.append({
            "title": _child_text(entry, {"title"}),
            "url": link,
            "published": _child_text(entry, {"published", "updated"}),
            "summary": _strip_html(_child_text(entry, {"summary", "content"}))[:800],
            "source": source_name,
        })
    return items

def _candidate_urls(source: dict, limit: int) -> list[str]:
    url = str(source.get("url") or "").strip()
    urls = [url] if url else []
    fallback = str(source.get("fallback_url") or "").strip()
    if fallback:
        urls.append(fallback)
    # arXiv RSS occasionally fails on some networks. Fall back to the official Atom API.
    m = re.search(r"rss\.arxiv\.org/rss/([^/?#]+)", url)
    if m:
        category = m.group(1)
        api = f"https://export.arxiv.org/api/query?search_query={quote('cat:'+category)}&start=0&max_results={limit}&sortBy=submittedDate&sortOrder=descending"
        urls.extend([api, api.replace("https://", "http://", 1)])
    out=[]
    for x in urls:
        if x and x not in out:
            out.append(x)
    return out

def _download(url: str) -> bytes:
    req = Request(url, headers={
        "User-Agent": "Workbench/260920.2 (+local research RSS reader)",
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.5",
    })
    with urlopen(req, timeout=12) as r:
        return r.read(MAX_BYTES)

def _fetch_source(source: dict, limit: int) -> tuple[list[dict], dict]:
    errors=[]
    urls=_candidate_urls(source, limit)
    for url in urls:
        for attempt in range(2):
            try:
                xml=_download(url)
                items=_parse_feed(xml, str(source.get("name") or "RSS"), limit)
                if items:
                    return items, {"source": source.get("name"), "ok": True, "count": len(items), "url": url, "fallback": url != str(source.get("url") or "")}
                errors.append(f"{url}: feed parsed but no entries")
            except (HTTPError, URLError, TimeoutError, ET.ParseError, OSError, ValueError) as e:
                errors.append(f"{url}: {e}")
            if attempt == 0:
                time.sleep(0.25)
    return [], {"source": source.get("name"), "ok": False, "count": 0, "url": str(source.get("url") or ""), "error": errors[-1] if errors else "unknown error", "attempts": errors[-6:]}

def _read_cache() -> dict | None:
    p=_cache_path()
    if not p.exists(): return None
    try:
        data=json.loads(p.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None

def _write_cache(data: dict) -> None:
    p=_cache_path(); p.parent.mkdir(parents=True, exist_ok=True)
    tmp=p.with_suffix(".tmp"); tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"); tmp.replace(p)

def fetch(force: bool = False) -> dict:
    old_cache=_read_cache()
    if old_cache and not force and time.time()-float(old_cache.get("timestamp",0)) < CACHE_TTL:
        return old_cache
    cfg=get_rss(); limit=max(1,min(50,int(cfg.get("max_items_per_source",12))))
    sources=[s for s in cfg.get("sources",[]) if s.get("enabled",True) and s.get("url")]
    if not sources:
        return {"timestamp": time.time(), "updated": datetime.now().isoformat(timespec="seconds"), "items": [], "errors": [], "sources": [], "message": "未配置启用的资讯源"}
    all_items=[]; statuses=[]
    with ThreadPoolExecutor(max_workers=min(6,max(1,len(sources)))) as pool:
        jobs={pool.submit(_fetch_source,s,limit):s for s in sources}
        for fut in as_completed(jobs):
            try:
                items,status=fut.result(); all_items.extend(items); statuses.append(status)
            except Exception as e:
                src=jobs[fut]; statuses.append({"source":src.get("name"),"ok":False,"count":0,"url":src.get("url"),"error":str(e)})
    # Deduplicate by URL/title and put newest-looking strings first.
    dedup=[]; seen=set()
    for item in all_items:
        key=(item.get("url") or item.get("title") or "").strip()
        if not key or key in seen: continue
        seen.add(key); dedup.append(item)
    dedup.sort(key=lambda x:x.get("published") or "", reverse=True)
    errors=[{"source":x.get("source"),"error":x.get("error"),"attempts":x.get("attempts",[])} for x in statuses if not x.get("ok")]
    data={"timestamp":time.time(),"updated":datetime.now().isoformat(timespec="seconds"),"items":dedup,"errors":errors,"sources":sorted(statuses,key=lambda x:str(x.get("source") or "")),"stale":False}
    if dedup:
        _write_cache(data)
        return data
    # Never replace a useful cache with a total network failure. Return stale data with diagnostics instead.
    if old_cache and old_cache.get("items"):
        stale=dict(old_cache); stale["stale"]=True; stale["errors"]=errors; stale["sources"]=data["sources"]; stale["refresh_failed_at"]=data["updated"]
        return stale
    # An empty failure result is deliberately not cached, so the next refresh retries immediately.
    return data
