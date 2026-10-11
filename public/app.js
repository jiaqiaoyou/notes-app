(function () {
  "use strict";

  const AUTOSAVE_MS = 650;

  const els = {
    viewAuth: document.getElementById("view-auth"),
    viewList: document.getElementById("view-list"),
    viewEditor: document.getElementById("view-editor"),
    noteList: document.getElementById("note-list"),
    emptyState: document.getElementById("empty-state"),
    search: document.getElementById("search"),
    btnNew: document.getElementById("btn-new"),
    btnBack: document.getElementById("btn-back"),
    btnDelete: document.getElementById("btn-delete"),
    btnLogout: document.getElementById("btn-logout"),
    noteTitle: document.getElementById("note-title"),
    noteBody: document.getElementById("note-body"),
    editorMeta: document.getElementById("editor-meta"),
    saveHint: document.getElementById("save-hint"),
    userBadge: document.getElementById("user-badge"),
    authForm: document.getElementById("auth-form"),
    authUsername: document.getElementById("auth-username"),
    authPassword: document.getElementById("auth-password"),
    authError: document.getElementById("auth-error"),
    authSubmit: document.getElementById("auth-submit"),
    tabLogin: document.getElementById("tab-login"),
    tabRegister: document.getElementById("tab-register"),
  };

  let user = null;
  let notes = [];
  let currentId = null;
  let dirty = false;
  let authMode = "login";
  let autoTimer = null;
  let saving = false;
  let pendingSave = false;
  let hintTimer = null;
  let metaTimer = null;

  async function api(path, options) {
    const opts = Object.assign({ credentials: "include" }, options || {});
    if (opts.body && typeof opts.body === "object" && !(opts.body instanceof FormData)) {
      opts.headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(path, opts);
    let data = null;
    const ct = res.headers.get("Content-Type") || "";
    if (ct.includes("application/json")) {
      try {
        data = await res.json();
      } catch {
        data = null;
      }
    }
    return { ok: res.ok, status: res.status, data };
  }

  function showAuthError(msg) {
    if (!msg) {
      els.authError.classList.add("hidden");
      els.authError.textContent = "";
      return;
    }
    els.authError.textContent = msg;
    els.authError.classList.remove("hidden");
  }

  function setAuthMode(mode) {
    authMode = mode;
    const isLogin = mode === "login";
    els.tabLogin.classList.toggle("active", isLogin);
    els.tabRegister.classList.toggle("active", !isLogin);
    els.tabLogin.setAttribute("aria-selected", isLogin ? "true" : "false");
    els.tabRegister.setAttribute("aria-selected", isLogin ? "false" : "true");
    els.authSubmit.textContent = isLogin ? "登录" : "注册";
    els.authPassword.autocomplete = isLogin ? "current-password" : "new-password";
    showAuthError("");
  }

  function showOnly(view) {
    els.viewAuth.classList.toggle("hidden", view !== "auth");
    els.viewList.classList.toggle("hidden", view !== "list");
    els.viewEditor.classList.toggle("hidden", view !== "editor");
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

  function formatRecentEdit(ts) {
    if (!ts) return "尚未编辑";
    const now = Date.now();
    const diff = Math.max(0, now - ts);
    if (diff < 45 * 1000) return "最近编辑：刚刚";
    if (diff < 60 * 60 * 1000) {
      const m = Math.floor(diff / 60000);
      return "最近编辑：" + m + " 分钟前";
    }
    try {
      const d = new Date(ts);
      const sameDay =
        d.getFullYear() === new Date(now).getFullYear() &&
        d.getMonth() === new Date(now).getMonth() &&
        d.getDate() === new Date(now).getDate();
      if (sameDay) {
        const hm = d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
        return "最近编辑：" + hm;
      }
      return "最近编辑：" + formatTime(ts);
    } catch {
      return "最近编辑：" + formatTime(ts);
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

  function setEditorMeta(ts) {
    els.editorMeta.textContent = formatRecentEdit(ts);
  }

  function setSaveHint(text, kind) {
    clearTimeout(hintTimer);
    els.saveHint.classList.remove("is-fading", "save-ok", "save-err", "save-info");
    els.saveHint.textContent = text || "";
    if (!text) return;
    if (kind === "ok") els.saveHint.classList.add("save-ok");
    else if (kind === "err") els.saveHint.classList.add("save-err");
    else if (kind === "info") els.saveHint.classList.add("save-info");
    if (kind === "ok") {
      hintTimer = setTimeout(() => {
        els.saveHint.classList.add("is-fading");
        hintTimer = setTimeout(() => {
          els.saveHint.textContent = "";
          els.saveHint.classList.remove("is-fading", "save-ok");
        }, 400);
      }, 1800);
    }
  }

  async function loadNotes() {
    const { ok, status, data } = await api("/api/notes");
    if (status === 401) {
      user = null;
      showOnly("auth");
      return;
    }
    if (!ok) {
      notes = [];
      renderList(els.search.value);
      els.emptyState.classList.remove("hidden");
      els.emptyState.textContent = (data && data.error) || "加载失败，请稍后重试。";
      return;
    }
    notes = data.notes || [];
    renderList(els.search.value);
  }

  function showList() {
    currentId = null;
    dirty = false;
    clearTimeout(autoTimer);
    clearTimeout(metaTimer);
    els.saveHint.textContent = "";
    showOnly("list");
    renderList(els.search.value);
  }

  function showEditor(note) {
    currentId = note.id;
    dirty = false;
    clearTimeout(autoTimer);
    showOnly("editor");
    els.noteTitle.value = note.title || "";
    els.noteBody.value = note.body || "";
    setEditorMeta(note.updatedAt);
    setSaveHint("", null);
    tickMeta();
    setTimeout(() => els.noteBody.focus(), 50);
  }

  function tickMeta() {
    clearTimeout(metaTimer);
    const note = notes.find((n) => n.id === currentId);
    if (!note || els.viewEditor.classList.contains("hidden")) return;
    // Don't overwrite an error hint's context—meta is separate
    setEditorMeta(note.updatedAt);
    metaTimer = setTimeout(tickMeta, 30000);
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

  async function createNote() {
    const { ok, data } = await api("/api/notes", {
      method: "POST",
      body: { title: "", body: "" },
    });
    if (!ok) {
      alert((data && data.error) || "创建失败");
      return;
    }
    notes.unshift(data.note);
    showEditor(data.note);
    dirty = true;
  }

  async function saveCurrent(opts) {
    const quiet = !opts || opts.quiet !== false;
    if (!currentId) return;
    if (saving) {
      pendingSave = true;
      return;
    }
    const note = notes.find((n) => n.id === currentId);
    if (!note) return;
    const title = els.noteTitle.value;
    const body = els.noteBody.value;
    saving = true;
    try {
      const { ok, data } = await api("/api/notes/" + encodeURIComponent(currentId), {
        method: "PUT",
        body: { title, body },
      });
      if (!ok) {
        const err = (data && data.error) || "自动保存失败";
        setSaveHint(err, "err");
        return;
      }
      note.title = data.note.title;
      note.body = data.note.body;
      note.updatedAt = data.note.updatedAt;
      dirty = false;
      setEditorMeta(note.updatedAt);
      if (quiet) {
        setSaveHint("已自动保存", "ok");
      }
    } catch {
      setSaveHint("自动保存失败，请检查网络", "err");
    } finally {
      saving = false;
      if (pendingSave) {
        pendingSave = false;
        if (dirty) scheduleAutosave();
      }
    }
  }

  async function deleteCurrent() {
    if (!currentId) return;
    if (!confirm("确定删除这篇笔记？")) return;
    clearTimeout(autoTimer);
    const id = currentId;
    const { ok, data } = await api("/api/notes/" + encodeURIComponent(id), {
      method: "DELETE",
    });
    if (!ok) {
      alert((data && data.error) || "删除失败");
      return;
    }
    notes = notes.filter((n) => n.id !== id);
    showList();
  }

  function scheduleAutosave() {
    dirty = true;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => saveCurrent({ quiet: true }), AUTOSAVE_MS);
  }

  async function handleAuthSubmit(e) {
    e.preventDefault();
    showAuthError("");
    const username = els.authUsername.value.trim();
    const password = els.authPassword.value;
    els.authSubmit.disabled = true;
    const path = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
    try {
      const { ok, data } = await api(path, {
        method: "POST",
        body: { username, password },
      });
      if (!ok) {
        showAuthError((data && data.error) || "操作失败");
        return;
      }
      user = data.user;
      els.userBadge.textContent = "@" + user.username;
      els.authPassword.value = "";
      await loadNotes();
      showList();
    } catch {
      showAuthError("网络错误，请稍后重试");
    } finally {
      els.authSubmit.disabled = false;
    }
  }

  async function handleLogout() {
    await api("/api/auth/logout", { method: "POST" });
    user = null;
    notes = [];
    currentId = null;
    showOnly("auth");
    setAuthMode("login");
  }

  async function boot() {
    showOnly("auth");
    try {
      const { ok, data } = await api("/api/auth/me");
      if (ok && data && data.user) {
        user = data.user;
        els.userBadge.textContent = "@" + user.username;
        await loadNotes();
        showList();
        return;
      }
    } catch {
      /* stay on auth */
    }
    showOnly("auth");
  }

  els.tabLogin.addEventListener("click", () => setAuthMode("login"));
  els.tabRegister.addEventListener("click", () => setAuthMode("register"));
  els.authForm.addEventListener("submit", handleAuthSubmit);
  els.btnNew.addEventListener("click", createNote);
  els.btnLogout.addEventListener("click", handleLogout);
  els.btnBack.addEventListener("click", async () => {
    clearTimeout(autoTimer);
    if (dirty) await saveCurrent({ quiet: true });
    showList();
  });
  els.btnDelete.addEventListener("click", deleteCurrent);
  els.search.addEventListener("input", () => renderList(els.search.value));
  els.noteTitle.addEventListener("input", scheduleAutosave);
  els.noteBody.addEventListener("input", scheduleAutosave);

  window.addEventListener("pagehide", () => {
    if (dirty && currentId) {
      const payload = JSON.stringify({
        title: els.noteTitle.value,
        body: els.noteBody.value,
      });
      try {
        fetch("/api/notes/" + encodeURIComponent(currentId), {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        });
      } catch {
        /* ignore */
      }
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && dirty && currentId) {
      clearTimeout(autoTimer);
      saveCurrent({ quiet: true });
    }
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }

  setAuthMode("login");
  boot();
})();
