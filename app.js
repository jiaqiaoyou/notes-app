(function () {
  "use strict";

  const STORAGE_KEY = "notes-app-v1";

  const els = {
    viewList: document.getElementById("view-list"),
    viewEditor: document.getElementById("view-editor"),
    noteList: document.getElementById("note-list"),
    emptyState: document.getElementById("empty-state"),
    search: document.getElementById("search"),
    btnNew: document.getElementById("btn-new"),
    btnBack: document.getElementById("btn-back"),
    btnSave: document.getElementById("btn-save"),
    btnDelete: document.getElementById("btn-delete"),
    noteTitle: document.getElementById("note-title"),
    noteBody: document.getElementById("note-body"),
    saveHint: document.getElementById("save-hint"),
  };

  let notes = [];
  let currentId = null;
  let dirty = false;
  let saveHintTimer = null;

  function loadNotes() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      notes = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(notes)) notes = [];
    } catch {
      notes = [];
    }
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  }

  function uid() {
    return "n_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function formatTime(ts) {
    try {
      return new Date(ts).toLocaleString("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }

  function previewText(body) {
    const t = (body || "").replace(/\s+/g, " ").trim();
    return t || "（空白）";
  }

  function displayTitle(note) {
    const t = (note.title || "").trim();
    if (t) return t;
    const first = (note.body || "").split(/\n/)[0].trim();
    return first || "无标题";
  }

  function showList() {
    currentId = null;
    dirty = false;
    els.viewEditor.classList.add("hidden");
    els.viewList.classList.remove("hidden");
    els.saveHint.textContent = "";
    renderList(els.search.value);
  }

  function showEditor(note) {
    currentId = note.id;
    dirty = false;
    els.viewList.classList.add("hidden");
    els.viewEditor.classList.remove("hidden");
    els.noteTitle.value = note.title || "";
    els.noteBody.value = note.body || "";
    els.saveHint.textContent = note.updatedAt
      ? "上次编辑：" + formatTime(note.updatedAt)
      : "";
    setTimeout(() => els.noteBody.focus(), 50);
  }

  function renderList(query) {
    const q = (query || "").trim().toLowerCase();
    const filtered = notes
      .slice()
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .filter((n) => {
        if (!q) return true;
        const hay = ((n.title || "") + "\n" + (n.body || "")).toLowerCase();
        return hay.includes(q);
      });

    els.noteList.innerHTML = "";
    if (filtered.length === 0) {
      els.emptyState.classList.remove("hidden");
      els.emptyState.textContent = q
        ? "没有匹配的笔记。"
        : "还没有笔记。点右上角「新建」开始写。";
      return;
    }
    els.emptyState.classList.add("hidden");

    const frag = document.createDocumentFragment();
    filtered.forEach((note) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "note-item";
      btn.setAttribute("role", "listitem");
      btn.innerHTML =
        '<span class="note-item-title"></span>' +
        '<span class="note-item-preview"></span>' +
        '<span class="note-item-meta"></span>';
      btn.querySelector(".note-item-title").textContent = displayTitle(note);
      btn.querySelector(".note-item-preview").textContent = previewText(note.body);
      btn.querySelector(".note-item-meta").textContent = formatTime(note.updatedAt);
      btn.addEventListener("click", () => openNote(note.id));
      li.appendChild(btn);
      frag.appendChild(li);
    });
    els.noteList.appendChild(frag);
  }

  function openNote(id) {
    const note = notes.find((n) => n.id === id);
    if (!note) return;
    showEditor(note);
  }

  function createNote() {
    const note = {
      id: uid(),
      title: "",
      body: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    notes.unshift(note);
    persist();
    showEditor(note);
    dirty = true;
  }

  function saveCurrent(showToast) {
    if (!currentId) return;
    const note = notes.find((n) => n.id === currentId);
    if (!note) return;
    note.title = els.noteTitle.value;
    note.body = els.noteBody.value;
    note.updatedAt = Date.now();
    persist();
    dirty = false;
    if (showToast) {
      els.saveHint.textContent = "已保存";
      clearTimeout(saveHintTimer);
      saveHintTimer = setTimeout(() => {
        els.saveHint.textContent = "上次编辑：" + formatTime(note.updatedAt);
      }, 1500);
    }
  }

  function deleteCurrent() {
    if (!currentId) return;
    if (!confirm("确定删除这篇笔记？")) return;
    notes = notes.filter((n) => n.id !== currentId);
    persist();
    showList();
  }

  function markDirty() {
    dirty = true;
  }

  // Autosave after short pause while typing
  let autoTimer = null;
  function scheduleAutosave() {
    markDirty();
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => saveCurrent(true), 600);
  }

  els.btnNew.addEventListener("click", createNote);
  els.btnBack.addEventListener("click", () => {
    if (dirty) saveCurrent(false);
    showList();
  });
  els.btnSave.addEventListener("click", () => saveCurrent(true));
  els.btnDelete.addEventListener("click", deleteCurrent);
  els.search.addEventListener("input", () => renderList(els.search.value));
  els.noteTitle.addEventListener("input", scheduleAutosave);
  els.noteBody.addEventListener("input", scheduleAutosave);

  // Save when leaving page / going to background
  window.addEventListener("pagehide", () => {
    if (dirty && currentId) saveCurrent(false);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && dirty && currentId) {
      saveCurrent(false);
    }
  });

  // Register service worker for offline / PWA
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }

  loadNotes();
  showList();
})();
