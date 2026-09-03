const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const CONTENT_DIR = path.join(ROOT, "content", "results");
const MEDIA_DIR = path.join(ROOT, "media");
const PORT = process.env.PORT || 3000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".gif": "image/gif",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".obj": "text/plain; charset=utf-8",
  ".mtl": "text/plain; charset=utf-8",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

// favicon/image/video 값이 http(s) URL이나 절대 경로가 아니면
// media/ 폴더 안의 파일명으로 간주해 /media/<파일명>으로 바꿔준다.
function resolveMediaUrl(value) {
  if (!value) return "";
  if (/^([a-z]+:)?\/\//i.test(value) || value.startsWith("/")) return value;
  return `/media/${value}`;
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 프론트매터(--- ... ---)와 본문을 분리하는 최소 파서. 중첩 없는
// flat key: value 쌍만 지원한다 (이 프로젝트의 카드 스키마 용도로 충분).
function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: raw };
  const [, fmBlock, body] = match;
  const data = {};
  for (const line of fmBlock.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[m[1]] = value;
  }
  return { data, body: body.trim() };
}

function inlineMarkdown(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
  // 이미지(![alt](url))는 링크보다 먼저 처리해야 링크 규칙에 잘못 먹히지 않는다.
  // media/ 안의 파일명만 적어도 되도록 resolveMediaUrl을 그대로 적용한다.
  out = out.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (match, alt, url) => `<img src="${resolveMediaUrl(url)}" alt="${alt}" loading="lazy" />`
  );
  out = out.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>'
  );
  return out;
}

// 표준 마크다운 서브셋(헤딩, 목록, 굵게/기울임, 링크, 코드, 문단)을
// 지원하는 최소 컨버터. 외부 패키지 없이 카드 본문 정도를 렌더링하는
// 용도로 충분하다.
function markdownToHtml(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const htmlParts = [];
  let listBuffer = [];
  let paraBuffer = [];

  const flushParagraph = () => {
    if (paraBuffer.length) {
      htmlParts.push(`<p>${inlineMarkdown(paraBuffer.join(" "))}</p>`);
      paraBuffer = [];
    }
  };
  const flushList = () => {
    if (listBuffer.length) {
      htmlParts.push(
        `<ul>${listBuffer.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`
      );
      listBuffer = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    const headingMatch = line.match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length;
      htmlParts.push(`<h${level}>${inlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }
    const listMatch = line.match(/^[-*]\s+(.*)$/);
    if (listMatch) {
      flushParagraph();
      listBuffer.push(listMatch[1]);
      continue;
    }
    flushList();
    paraBuffer.push(line);
  }
  flushParagraph();
  flushList();
  return htmlParts.join("\n");
}

// 카드 리스트용 요약은 본문에서 자동으로 뽑지 않고 프론트매터의
// description 값을 그대로 쓴다. 너무 길면 잘라서 "…"을 붙인다.
function truncateText(text, limit = 160) {
  const trimmed = text.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit).trim()}…` : trimmed;
}

// 프론트매터의 date(예: "2024-12-02")를 구글 검색결과 스니펫에 쓰이는
// "2024. 12. 2." 형식으로 바꾼다. 파싱 불가능하면 원문 그대로 둔다.
function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

function loadResults() {
  if (!fs.existsSync(CONTENT_DIR)) return [];
  const files = fs
    .readdirSync(CONTENT_DIR)
    .filter((name) => name.endsWith(".md"))
    .sort();

  return files.map((file) => {
    const slug = file.replace(/\.md$/, "");
    const raw = fs.readFileSync(path.join(CONTENT_DIR, file), "utf8");
    const { data, body } = parseFrontmatter(raw);
    const dateLabel = formatDate(data.date);
    const description = truncateText(data.description || "");
    const tags = (data.tags || "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    return {
      slug,
      title: data.title || slug,
      type: data.type || "",
      siteUrl: data.siteUrl || "",
      favicon: resolveMediaUrl(data.favicon),
      image: resolveMediaUrl(data.image),
      video: resolveMediaUrl(data.video),
      date: dateLabel,
      dateISO: data.date || "",
      tags,
      bodyHtml: markdownToHtml(body),
      bodyText: dateLabel ? `${dateLabel} — ${description}` : description,
    };
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function serveStatic(res, pathname) {
  const filePath = path.join(ROOT, pathname === "/" ? "index.html" : pathname);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/results") {
    try {
      sendJson(res, 200, loadResults());
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return;
  }

  serveStatic(res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`http://localhost:${PORT} 에서 서버가 실행 중입니다.`);
  console.log(`마크다운 결과 파일 위치: ${CONTENT_DIR}`);
  console.log(`이미지/비디오 파일 위치: ${MEDIA_DIR}`);
});
