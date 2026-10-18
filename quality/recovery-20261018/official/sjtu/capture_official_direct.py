"""Bounded, robots-aware fresh captures for the two assigned official sources."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import subprocess
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser

BASE = Path(__file__).resolve().parent.parent
SOURCES = {
    "sjtu-spring-2027": ("sjtu", "https://www.oec.sjtu.edu.cn/en/pressreleases/info.aspx?itemid=6157", "html"),
    "xjtu-full-guide-2027-direct": ("xjtu", "https://sie.xjtu.edu.cn/en/info/1165/3212.htm", "html"),
    "xjtu-brochure-2027-direct": ("xjtu", "https://sie.xjtu.edu.cn/__local/D/3B/55/11E8A37A7F7047E740921538CA1_2E732B70_4489F7.pdf", "pdf"),
    "xjtu-application-route-direct": ("xjtu", "https://isso.xjtu.edu.cn/recruit/login", "html"),
}

AGENT = "StudyInChina-Official-Verification/1.0"

def now():
    return datetime.now(timezone.utc).isoformat()

def digest(data):
    return hashlib.sha256(data).hexdigest()

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

def get(url, allowed_host, maximum):
    redirects = []
    current = url
    for _ in range(6):
        parts = urllib.parse.urlsplit(current)
        if parts.scheme != "https" or parts.hostname != allowed_host or parts.username or parts.password:
            raise ValueError("Rejected URL outside exact official HTTPS host")
        req = urllib.request.Request(current, headers={"User-Agent": AGENT, "Accept": "*/*"})
        try:
            response = OPENER.open(req, timeout=40)
        except urllib.error.HTTPError as exc:
            response = exc
        status = response.status
        if status in (301, 302, 303, 307, 308):
            location = urllib.parse.urljoin(current, response.headers.get("Location", ""))
            redirects.append({"url": current, "status": status, "location": location})
            response.close()
            current = location
            continue
        data = response.read(maximum + 1)
        headers = {key: value for key, value in response.headers.items() if key.lower() in {"content-type", "content-length", "date", "last-modified", "etag"}}
        response.close()
        if len(data) > maximum:
            raise ValueError("Response exceeded bounded size")
        return {"requestedUrl": url, "url": current, "status": status, "retrievedAt": now(), "redirects": redirects, "headers": headers}, data
    raise ValueError("Too many redirects")

class Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip = 0
        self.out = []
        self.links = []
    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript"):
            self.skip += 1
        if not self.skip and tag in ("p", "div", "br", "li", "tr", "h1", "h2", "h3", "td"):
            self.out.append("\n")
        if tag == "a":
            for key, value in attrs:
                if key == "href" and value:
                    self.links.append(value)
    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript") and self.skip:
            self.skip -= 1
        if not self.skip and tag in ("p", "div", "li", "tr", "h1", "h2", "h3"):
            self.out.append("\n")
    def handle_data(self, data):
        if not self.skip:
            self.out.append(data)

def save_json(path, value):
    with path.open("x", encoding="utf-8", newline="\n") as output:
        json.dump(value, output, ensure_ascii=False, indent=2)
        output.write("\n")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("name", choices=SOURCES)
    args = parser.parse_args()
    school, url, kind = SOURCES[args.name]
    directory = BASE / school
    directory.mkdir(parents=True, exist_ok=True)
    stem = directory / args.name
    if list(directory.glob(args.name + ".*")):
        raise RuntimeError("Capture identity already exists; do not overwrite/replay")
    attempt = {"source": url, "startedAt": now(), "userAgent": AGENT, "proxy": "direct-normal-HTTPS-after-proxy-TLS-failure", "maximumBytes": (32 if kind == "pdf" else 8) * 1024 * 1024}
    try:
        host = urllib.parse.urlsplit(url).hostname
        robot_url = f"https://{host}/robots.txt"
        robot, robot_bytes = get(robot_url, host, 1024 * 1024)
        robot_path = directory / (args.name + ".robots.txt")
        robot_path.write_bytes(robot_bytes)
        robot.update({"rawPath": str(robot_path.relative_to(BASE.parent.parent.parent)).replace("\\", "/"), "sha256": digest(robot_bytes)})
        attempt["robots"] = robot
        allowed = robot["status"] in (404, 410)
        if 200 <= robot["status"] < 300:
            rules = urllib.robotparser.RobotFileParser(robot_url)
            rules.parse(robot_bytes.decode("utf-8", errors="replace").splitlines())
            allowed = rules.can_fetch(AGENT, url)
        robot["canFetch"] = allowed
        if not allowed:
            raise RuntimeError(f"Robots held: HTTP {robot['status']} or disallowed")
        receipt, data = get(url, host, attempt["maximumBytes"])
        attempt["response"] = receipt
        if receipt["status"] != 200:
            raise RuntimeError(f"Source HTTP {receipt['status']}; held without identity retry")
        if kind == "pdf" and not data.startswith(b"%PDF-"):
            raise RuntimeError("Expected genuine PDF bytes")
        raw_path = stem.with_suffix("." + kind)
        with raw_path.open("xb") as output:
            output.write(data)
        text_path = stem.with_suffix(".text.txt")
        links = []
        if kind == "pdf":
            subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", str(raw_path), str(text_path)], check=True, timeout=60)
        else:
            body = data.decode("utf-8", errors="replace")
            html = Text()
            html.feed(body)
            rendered = "\n".join(line.strip() for line in "".join(html.out).splitlines() if line.strip()) + "\n"
            with text_path.open("x", encoding="utf-8", newline="\n") as output:
                output.write(rendered)
            links = list(dict.fromkeys(urllib.parse.urljoin(receipt["url"], link) for link in html.links))
        text_bytes = text_path.read_bytes()
        receipt.update({"sourceName": args.name, "contentType": receipt["headers"].get("Content-Type"), "rawPath": raw_path.as_posix(), "rawBytes": len(data), "sha256": digest(data), "textPath": text_path.as_posix(), "textSha256": digest(text_bytes), "robots": robot, "links": links, "captureMethod": "normal-direct-HTTPS-TLS-verified-after-proxy-handshake-failure; manual-same-host-redirect; bounded-response; no-authentication-or-WAF-bypass"})
        save_json(stem.with_suffix(".receipt.json"), receipt)
        attempt["outcome"] = "captured"
        print(json.dumps({key: receipt[key] for key in ("sourceName", "status", "retrievedAt", "rawBytes", "sha256", "textSha256")}, ensure_ascii=False))
    except Exception as exc:
        attempt.update({"outcome": "held", "error": str(exc), "endedAt": now()})
        save_json(stem.with_suffix(".attempt.json"), attempt)
        raise
    else:
        attempt["endedAt"] = now()
        save_json(stem.with_suffix(".attempt.json"), attempt)

if __name__ == "__main__":
    main()
