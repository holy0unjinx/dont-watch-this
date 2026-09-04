// 문서 탐색기: media/model/model.obj와 content/results/*.md(=/api/results)를
// 파일 목록으로 보여준다. model.obj를 고르면 3D 미리보기가 뜨고, 문서를 열면
// 메모장 창이 그 내용을 띄운다.
import { desktop } from "./window-manager.js";
import { mountModelViewer } from "./model-viewer.js";

const NOTEPAD_ID = "notepad";
const NOTEPAD_DEFAULT_TITLE = "메모장";

const card = document.querySelector('.window-card[data-window="explorer"]');
const list = card && card.querySelector(".explorer-list");
const preview = card && card.querySelector(".explorer-preview");
const previewStatus = card && card.querySelector(".explorer-preview-status");
const statusEl = card && card.querySelector(".explorer-status");
const canvas = card && card.querySelector("#explorer-model-canvas");

const notepadCard = document.querySelector(`.window-card[data-window="${NOTEPAD_ID}"]`);
const notepadDoc = notepadCard && notepadCard.querySelector(".notepad-doc");
const notepadError = notepadCard && notepadCard.querySelector(".notepad-error");
const notepadText = notepadCard && notepadCard.querySelector(".notepad-text");

// 파일 이름에 못 쓰는 문자를 걷어내고 너무 길면 자른다.
function toFileName(title, extension = "txt") {
  const cleaned = String(title || "제목 없음")
    .replace(/[\\/:*?"<>|]/g, "")
    .trim();
  const trimmed = cleaned.length > 28 ? `${cleaned.slice(0, 27)}…` : cleaned;
  return `${trimmed}.${extension}`;
}

function documentBody(result) {
  const lines = [result.title, "".padEnd(Math.max(4, result.title.length * 2), "="), ""];
  if (result.date) lines.push(`작성일: ${result.date}`);
  if (result.type) lines.push(`분류: ${result.type}`);
  if (result.siteUrl) lines.push(`링크: ${result.siteUrl}`);
  lines.push("", result.bodyText || "(내용 없음)");
  return lines.join("\n");
}

function openInNotepad(file) {
  if (!notepadDoc || !notepadText) return;
  notepadText.textContent = file.body;
  notepadDoc.hidden = false;
  if (notepadError) notepadError.hidden = true;
  desktop.setTitle(NOTEPAD_ID, `${file.name} - 메모장`);
  desktop.open(NOTEPAD_ID);
}

// 메모장의 "확인"을 누르면 원래 오류 대화상자로 돌아가고 창이 닫힌다.
if (notepadCard) {
  notepadCard.querySelector(".notepad-dismiss")?.addEventListener("click", () => {
    desktop.close(NOTEPAD_ID);
  });
}

if (list) {
  let files = [];
  let selected = null;
  let viewer = null;

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function showPreview(show) {
    if (!preview) return;
    preview.hidden = !show;
    if (show) viewer?.resize();
  }

  function mountViewer() {
    if (viewer || !canvas) return;
    viewer = mountModelViewer(canvas, {
      onStatus: (text) => {
        if (!previewStatus) return;
        previewStatus.textContent = text;
        previewStatus.hidden = !text;
      },
    });
    viewer.ready.then((ok) => {
      if (ok) preview.classList.add("is-ready");
    });
  }

  function select(file, row) {
    selected = file;
    for (const node of list.querySelectorAll(".explorer-row")) {
      const isTarget = node === row;
      node.classList.toggle("is-selected", isTarget);
      node.setAttribute("aria-selected", String(isTarget));
    }

    if (file.kind === "model") {
      showPreview(true);
      mountViewer();
      setStatus("model.obj — 드래그해서 돌려볼 수 있습니다.");
    } else {
      showPreview(false);
      setStatus(`${file.name} — 두 번 누르면 메모장에서 열립니다.`);
    }
  }

  function open(file) {
    if (file.kind === "model") {
      showPreview(true);
      mountViewer();
      return;
    }
    openInNotepad(file);
  }

  function addRow(file) {
    const row = document.createElement("li");
    row.className = "explorer-row";
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", "false");
    row.tabIndex = 0;

    const icon = document.createElement("span");
    icon.className = `explorer-icon explorer-icon--${file.kind}`;
    icon.setAttribute("aria-hidden", "true");
    row.append(icon, document.createTextNode(file.name));

    row.addEventListener("click", () => select(file, row));
    row.addEventListener("dblclick", () => open(file));
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      select(file, row);
      open(file);
    });

    list.appendChild(row);
    return row;
  }

  async function load() {
    files = [
      {
        kind: "model",
        name: "model.obj",
      },
    ];

    try {
      const response = await fetch("/api/results");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const results = await response.json();
      for (const result of results) {
        files.push({
          kind: "doc",
          name: toFileName(result.title),
          body: documentBody(result),
        });
      }
      setStatus(`${files.length}개 항목`);
    } catch (err) {
      console.error("[explorer] 문서 목록을 불러오지 못했습니다", err);
      setStatus("문서 목록을 불러오지 못했습니다 (서버 실행 중인지 확인)");
    }

    list.replaceChildren();
    for (const file of files) addRow(file);
  }

  // 창 크기가 바뀌면 미리보기 캔버스도 다시 잡아야 한다.
  card.addEventListener("window:resize", () => viewer?.resize());

  load();
}
