document.addEventListener("DOMContentLoaded", async () => {
  const contents = document.querySelector("#google .contents");
  const backdrop = document.querySelector("#google .contents-backdrop");
  const cardsContainer = document.querySelector("#google .cards");
  const resultMeta = document.querySelector("#google .result-meta");
  if (!contents || !cardsContainer) return;

  // sticky 헤더(로고+검색바)의 실제 높이를 재서 지식패널이 그 아래에서
  // sticky 되도록 CSS 변수로 넘겨준다. (.result-tabs는 sticky가 아니므로 제외)
  const topbar = document.querySelector("#google header");
  const syncTopbarHeight = () => {
    if (!topbar) return;
    document.documentElement.style.setProperty(
      "--google-topbar-height",
      `${topbar.getBoundingClientRect().height}px`
    );
  };
  syncTopbarHeight();
  window.addEventListener("resize", syncTopbarHeight);
  window.addEventListener("load", syncTopbarHeight);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(syncTopbarHeight);
  }

  const escapeHtml = (str) =>
    String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  // 구글 검색결과의 URL 브레드크럼처럼 "github.com > holy0unjinx > eco-ing"
  // 형태로 보여준다. 화살표(>)는 SVG 아이콘이고, 경로 조각은 최대 2개까지만
  // (host 뒤에 화살표가 최대 2번).
  const BREADCRUMB_ARROW =
    '<svg class="breadcrumb-arrow" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>';

  const siteBreadcrumb = (url) => {
    if (!url) return "";
    let host;
    let segments = [];
    try {
      const parsed = new URL(url);
      host = parsed.hostname.replace(/^www\./, "");
      segments = parsed.pathname.split("/").filter(Boolean).slice(0, 2);
    } catch {
      return escapeHtml(url);
    }
    return [host, ...segments].map((part) => escapeHtml(part)).join(BREADCRUMB_ARROW);
  };

  const kgTitle = contents.querySelector(".kg-title");
  const kgType = contents.querySelector(".kg-type");
  const kgMedia = contents.querySelector(".kg-media");
  const kgBody = contents.querySelector(".kg-body");
  const kgSiteLink = contents.querySelector(".kg-site-link");
  const closeBtn = contents.querySelector(".close-btn");

  const renderMedia = (data) => {
    kgMedia.innerHTML = "";
    if (data.video) {
      const video = document.createElement("video");
      video.src = data.video;
      video.controls = true;
      kgMedia.appendChild(video);
    } else if (data.image) {
      const img = document.createElement("img");
      img.src = data.image;
      img.alt = data.title;
      kgMedia.appendChild(img);
    }
  };

  const applyState = (data) => {
    kgTitle.textContent = data.title;
    kgType.textContent = data.type;
    renderMedia(data);
    kgBody.innerHTML = data.bodyHtml || "";
    if (data.siteUrl) {
      kgSiteLink.href = data.siteUrl;
      kgSiteLink.style.display = "";
    } else {
      kgSiteLink.removeAttribute("href");
      kgSiteLink.style.display = "none";
    }
  };

  const isMobileLayout = () => window.matchMedia("(max-width: 768px)").matches;

  let cards = [];
  const cardData = new WeakMap();

  // 뷰포트 상단에 가장 가까이 걸쳐 있는, 필터에 걸리지 않은 카드를 찾는다
  // (스크롤스파이). 필터로 숨겨진 카드는 후보에서 제외한다.
  const getTopMostCard = () => {
    const visible = cards.filter((card) => !card.classList.contains("is-filtered-out"));
    if (!visible.length) return null;
    const threshold = 96;
    let current = visible[0];
    for (const card of visible) {
      if (card.getBoundingClientRect().top - threshold <= 0) {
        current = card;
      } else {
        break;
      }
    }
    return current;
  };

  let isHovering = false;
  let activeCard = null;

  // .contents에 반영된 카드를 목록에서도 하이라이트해준다.
  const activateCard = (card) => {
    applyState(cardData.get(card));
    if (activeCard === card) return;
    if (activeCard) activeCard.classList.remove("is-active");
    card.classList.add("is-active");
    activeCard = card;
  };

  const syncToViewport = () => {
    if (isHovering || !cards.length) return;
    const card = getTopMostCard();
    if (card) activateCard(card);
  };

  let ticking = false;
  window.addEventListener(
    "scroll",
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        syncToViewport();
        ticking = false;
      });
    },
    { passive: true }
  );
  window.addEventListener("resize", syncToViewport);

  let lockedScrollY = 0;

  const lockBackgroundScroll = () => {
    lockedScrollY = window.scrollY;
    document.body.style.position = "fixed";
    document.body.style.top = `-${lockedScrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
  };

  const unlockBackgroundScroll = () => {
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    window.scrollTo(0, lockedScrollY);
  };

  const openContents = () => {
    contents.classList.add("is-open");
    if (backdrop) backdrop.classList.add("is-open");
    lockBackgroundScroll();
    resetSheetHeight();
  };

  const closeContents = () => {
    contents.classList.remove("is-open");
    if (backdrop) backdrop.classList.remove("is-open");
    unlockBackgroundScroll();
  };

  // 모바일 바텀시트: 안에서 스크롤할 내용이 생기면, 내용이 스크롤되기 전에
  // 시트 자체가 먼저 뷰포트를 덮듯이 커지고, 최대 높이에 닿은 뒤에야
  // 내부 콘텐츠가 스크롤된다.
  const SHEET_MIN_VH = 65;
  const SHEET_MAX_VH = 92;
  let sheetVh = SHEET_MIN_VH;
  let dragStartY = 0;
  let dragStartVh = SHEET_MIN_VH;
  let dragging = false;

  const setSheetHeight = (vh) => {
    sheetVh = Math.min(SHEET_MAX_VH, Math.max(SHEET_MIN_VH, vh));
    contents.style.height = `${sheetVh}vh`;
  };

  const resetSheetHeight = () => {
    contents.scrollTop = 0;
    setSheetHeight(SHEET_MIN_VH);
  };

  contents.addEventListener(
    "touchstart",
    (e) => {
      if (!isMobileLayout() || !contents.classList.contains("is-open")) return;
      dragging = true;
      dragStartY = e.touches[0].clientY;
      dragStartVh = sheetVh;
    },
    { passive: true }
  );

  contents.addEventListener(
    "touchmove",
    (e) => {
      if (!dragging) return;
      const draggedUp = dragStartY - e.touches[0].clientY;
      const atMax = sheetVh >= SHEET_MAX_VH - 0.5;
      const scrolledIntoContent = contents.scrollTop > 0;

      if (draggedUp > 0 && !atMax) {
        e.preventDefault();
        setSheetHeight(dragStartVh + (draggedUp / window.innerHeight) * 100);
      } else if (draggedUp < 0 && !scrolledIntoContent) {
        e.preventDefault();
        setSheetHeight(dragStartVh + (draggedUp / window.innerHeight) * 100);
      }
    },
    { passive: false }
  );

  contents.addEventListener(
    "touchend",
    () => {
      dragging = false;
    },
    { passive: true }
  );

  // 터치가 없는 데스크톱(마우스 휠/트랙패드)로 모바일 폭을 테스트할 때도
  // 같은 방식으로 동작하도록 wheel 이벤트에도 동일 로직을 연결한다.
  contents.addEventListener(
    "wheel",
    (e) => {
      if (!isMobileLayout() || !contents.classList.contains("is-open")) return;
      const atMax = sheetVh >= SHEET_MAX_VH - 0.5;
      const scrolledIntoContent = contents.scrollTop > 0;
      const delta = Math.max(-40, Math.min(40, e.deltaY));

      if (delta > 0 && !atMax) {
        e.preventDefault();
        setSheetHeight(sheetVh + (delta / window.innerHeight) * 100);
      } else if (delta < 0 && !scrolledIntoContent) {
        e.preventDefault();
        setSheetHeight(sheetVh + (delta / window.innerHeight) * 100);
      }
    },
    { passive: false }
  );

  // 카드에서 .contents로 마우스가 넘어가도 유지되도록, hover 해제는
  // 카드 하나가 아니라 컨테이너 전체(카드 + 패널)를 벗어날 때만 처리한다.
  const container = document.querySelector("#google .container");
  if (container) {
    container.addEventListener("mouseleave", () => {
      isHovering = false;
      syncToViewport();
    });
  }

  if (closeBtn) closeBtn.addEventListener("click", closeContents);
  if (backdrop) backdrop.addEventListener("click", closeContents);

  // -- 더보기 옆 필터(태그 / 날짜 정렬 / 기간) -------------------------------
  const resultFilter = document.querySelector("#google .result-filter");
  const filterToggle = document.querySelector("#google .filter-toggle");
  const filterPanel = document.querySelector("#google .filter-panel");
  const filterTagsGroup = document.querySelector("#google .filter-tags-group");
  const filterTagsContainer = document.querySelector("#google .filter-tags");
  const filterDateFrom = document.querySelector("#google .filter-date-from");
  const filterDateTo = document.querySelector("#google .filter-date-to");
  const filterReset = document.querySelector("#google .filter-reset");
  const sortRadios = Array.from(
    document.querySelectorAll('#google input[name="sort-order"]')
  );

  const activeTags = new Set();
  let sortOrder = "date-desc"; // 날짜순(최신이 위로)이 기본
  let cardsEmptyFiltered = null;

  // 필터에 걸리는(태그+기간 조건을 통과하는) 카드 중 처음 몇 개까지만 보여줄지.
  // "더보기" 클릭 시 PAGE_SIZE만큼 늘어난다. 필터/정렬 조건이 바뀌면 다시 처음으로.
  const PAGE_SIZE = 5;
  let visibleLimit = PAGE_SIZE;
  let cardsLoadMore = null;

  // date는 모두 있다고 가정 — dateISO(예: "2024-12-02")를 그대로 비교한다.
  const passesDateRange = (data) => {
    if (!filterDateFrom.value && !filterDateTo.value) return true;
    const d = new Date(data.dateISO);
    if (filterDateFrom.value && d < new Date(filterDateFrom.value)) return false;
    if (filterDateTo.value && d > new Date(filterDateTo.value)) return false;
    return true;
  };

  const applySort = () => {
    const order = [...cards].sort((a, b) => {
      const da = new Date(cardData.get(a).dateISO).getTime();
      const db = new Date(cardData.get(b).dateISO).getTime();
      return sortOrder === "date-asc" ? da - db : db - da;
    });
    order.forEach((card) => cardsContainer.appendChild(card));
    if (cardsLoadMore) cardsContainer.appendChild(cardsLoadMore);
    if (cardsEmptyFiltered) cardsContainer.appendChild(cardsEmptyFiltered);
    cards = order;
  };

  // resetPage=false는 "더보기" 클릭에서만 쓴다 (현재 노출 개수를 유지한 채 늘리기 위해).
  const applyFilter = (resetPage = true) => {
    if (resetPage) visibleLimit = PAGE_SIZE;
    applySort();

    let matchCount = 0;
    let visibleCount = 0;
    cards.forEach((card) => {
      const data = cardData.get(card);
      const tagMatch = activeTags.size === 0 || data.tags.some((tag) => activeTags.has(tag));
      const matches = tagMatch && passesDateRange(data);
      let show = false;
      if (matches) {
        show = matchCount < visibleLimit;
        matchCount += 1;
      }
      card.classList.toggle("is-filtered-out", !show);
      if (show) visibleCount += 1;
    });

    if (cardsEmptyFiltered) {
      cardsEmptyFiltered.hidden = visibleCount !== 0;
    }
    if (cardsLoadMore) {
      cardsLoadMore.hidden = matchCount <= visibleLimit;
    }
    if (filterToggle) {
      const isActive =
        activeTags.size > 0 ||
        sortOrder !== "date-desc" ||
        filterDateFrom.value ||
        filterDateTo.value;
      filterToggle.classList.toggle("is-active", Boolean(isActive));
    }
    syncToViewport();
  };

  const buildFilterPanel = (results) => {
    if (!resultFilter || !filterToggle || !filterPanel) return;
    const allTags = Array.from(new Set(results.flatMap((data) => data.tags))).sort((a, b) =>
      a.localeCompare(b, "ko")
    );

    if (filterTagsGroup) filterTagsGroup.classList.toggle("is-empty", !allTags.length);

    activeTags.clear();
    if (filterTagsContainer) {
      filterTagsContainer.innerHTML = "";
      allTags.forEach((tag) => {
        const label = document.createElement("label");
        label.className = "filter-tag";
        label.innerHTML = `<input type="checkbox" value="${escapeHtml(tag)}" />${escapeHtml(tag)}`;
        label.querySelector("input").addEventListener("change", (e) => {
          if (e.target.checked) activeTags.add(tag);
          else activeTags.delete(tag);
          applyFilter();
        });
        filterTagsContainer.appendChild(label);
      });
    }
  };

  sortRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      if (radio.checked) {
        sortOrder = radio.value;
        applyFilter();
      }
    });
  });

  if (filterDateFrom) filterDateFrom.addEventListener("change", applyFilter);
  if (filterDateTo) filterDateTo.addEventListener("change", applyFilter);

  if (filterReset) {
    filterReset.addEventListener("click", () => {
      activeTags.clear();
      if (filterTagsContainer) {
        filterTagsContainer
          .querySelectorAll("input[type=checkbox]")
          .forEach((input) => (input.checked = false));
      }
      sortOrder = "date-desc";
      sortRadios.forEach((radio) => {
        radio.checked = radio.value === "date-desc";
      });
      if (filterDateFrom) filterDateFrom.value = "";
      if (filterDateTo) filterDateTo.value = "";
      applyFilter();
    });
  }

  if (filterToggle && filterPanel) {
    filterToggle.addEventListener("click", () => {
      const isOpen = filterPanel.classList.toggle("is-open");
      filterToggle.setAttribute("aria-expanded", String(isOpen));
    });
    document.addEventListener("click", (e) => {
      if (resultFilter && !resultFilter.contains(e.target)) {
        filterPanel.classList.remove("is-open");
        filterToggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  // #google .cards .card 마크업을 마크다운(content/results/*.md)에서 가져온
  // 데이터로 렌더링한다. server.js를 통해 서빙 중일 때만 동작한다.
  const buildCard = (data) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-heading">
        <img src="${escapeHtml(data.favicon)}" alt="" />
        <div class="text">${escapeHtml(data.type || data.slug)}<span>${siteBreadcrumb(
          data.siteUrl
        )}</span></div>
      </div>
      <div class="card-content">
        <h1>${escapeHtml(data.title)}</h1>
        <p>${escapeHtml(data.bodyText)}</p>
      </div>
    `;
    return card;
  };

  const renderCards = (results) => {
    cardsContainer.innerHTML = "";
    if (!results.length) {
      cardsContainer.innerHTML =
        '<p class="cards-empty">content/results 폴더에 .md 파일을 추가하면 여기 표시됩니다.</p>';
      return;
    }
    results.forEach((data) => {
      const card = buildCard(data);
      cardData.set(card, data);
      card.addEventListener("mouseenter", () => {
        isHovering = true;
        activateCard(card);
      });
      card.addEventListener("click", () => {
        activateCard(card);
        if (isMobileLayout()) openContents();
      });
      cardsContainer.appendChild(card);
    });
    cards = Array.from(cardsContainer.querySelectorAll(".card"));

    cardsLoadMore = document.createElement("button");
    cardsLoadMore.type = "button";
    cardsLoadMore.className = "cards-load-more";
    cardsLoadMore.textContent = "더보기";
    cardsLoadMore.hidden = true;
    cardsLoadMore.addEventListener("click", () => {
      visibleLimit += PAGE_SIZE;
      applyFilter(false);
    });
    cardsContainer.appendChild(cardsLoadMore);

    cardsEmptyFiltered = document.createElement("p");
    cardsEmptyFiltered.className = "cards-empty";
    cardsEmptyFiltered.textContent = "조건에 맞는 결과가 없습니다.";
    cardsEmptyFiltered.hidden = true;
    cardsContainer.appendChild(cardsEmptyFiltered);

    buildFilterPanel(results);
    applyFilter();
  };

  try {
    const startedAt = performance.now();
    const res = await fetch("/api/results");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const results = await res.json();
    const elapsedSeconds = (performance.now() - startedAt) / 1000;
    renderCards(results);
    if (resultMeta) {
      const count = results.length.toLocaleString("ko-KR");
      resultMeta.textContent = `검색결과 ${count}개 (${elapsedSeconds.toFixed(2)}초)`;
    }
  } catch (err) {
    cardsContainer.innerHTML =
      '<p class="cards-empty">결과를 불러오지 못했습니다. 터미널에서 <code>node server.js</code>로 서버를 실행한 뒤 http://localhost:3000 으로 접속해주세요.</p>';
    if (resultMeta) resultMeta.textContent = "";
  }
});

// #windows: 세로 스크롤(휠)을 가로 스크롤로 바꿔서, 창들이 옆으로
// 넘어가게 한다. 마우스가 그 위에 있다고 무조건 가로채는 게 아니라,
// #windows가 뷰포트를 완전히 덮었을 때만(= 그 섹션을 보고 있는 동안만)
// 동작한다.
document.addEventListener("DOMContentLoaded", () => {
  const windowsSection = document.getElementById("windows");
  if (!windowsSection) return;

  const coversViewport = () => {
    const rect = windowsSection.getBoundingClientRect();
    return rect.top <= 1 && rect.bottom >= window.innerHeight - 1;
  };

  windowsSection.addEventListener(
    "wheel",
    (e) => {
      if (!coversViewport()) return;

      const maxScrollLeft = windowsSection.scrollWidth - windowsSection.clientWidth;
      const atStart = windowsSection.scrollLeft <= 0;
      const atEnd = windowsSection.scrollLeft >= maxScrollLeft - 1;
      // 맨 앞/맨 끝에서 계속 같은 방향으로 스크롤하면 가로채지 않고
      // 그대로 흘려보내서 페이지가 위/아래로 스크롤될 수 있게 한다.
      if ((e.deltaY < 0 && atStart) || (e.deltaY > 0 && atEnd)) return;
      e.preventDefault();
      windowsSection.scrollLeft += e.deltaY;
    },
    { passive: false }
  );
});
