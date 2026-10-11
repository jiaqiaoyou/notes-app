(function () {
  "use strict";

  const els = {
    viewAuth: document.getElementById("view-auth"),
    viewList: document.getElementById("view-list"),
    viewEditor: document.getElementById("view-editor"),
    noteList: document.getElementById("note-list"),
    emptyState: document.getElementById("empty-state"),
    search: document.getElementById("search"),
    btnNew: document.getElementById("btn-new"),
    btnBack: document.getElementById("btn-back"),
    btnSave: document.getElementById("btn-save"),
    btnDelete: document.getElementById("btn-delete"),
    btnLogout: document.getElementById("btn-logout"),
    noteTitle: document.getElementById("note-title"),
    noteBody: document.getElementById("note-body"),
    saveHint: document.getElementById("save-hint"),
    userBadge: document.getElementById("user-badge"),
    authForm: document.getElementById("auth-form"),
    authUsername: document.getElementById("auth-username"),
    authPassword: document.getElementById("auth-password"),
    authError: document.getElementById("auth-error"),
    authSubmit: document.getElementById("auth-submit"),
    tabLogin: document.getElementById("tab-login"),
    tabRegister: document.getElementById("tab-register"),
    toast: document.getElementById("toast"),
  };

  let user = null;
  let notes = [];
  let currentId = null;
  let dirty = false;
  let saveHintTimer = null;
  let authMode = "login"; // login | register
  let autoTimer = null;
  let saving = false;
  let toastTimer = null;
  let saveBtnTimer = null;
  const SAVE_BTN_LABEL = "保存";

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
    els.saveHint.textContent = "";
    showOnly("list");
    renderList(els.search.value);
  }

  function showEditor(note) {
    currentId = note.id;
    dirty = false;
    showOnly("editor");
    els.noteTitle.value = note.title || "";
    els.noteBody.value = note.body || "";
    setSaveButton("idle");
    setSaveHint(note.updatedAt ? "上次编辑：" + formatTime(note.updatedAt) : "", null);
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


  function showToast(message, kind) {
    if (!els.toast) return;
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.remove("hidden", "toast-ok", "toast-err", "toast-info");
    els.toast.classList.add(kind === "err" ? "toast-err" : kind === "info" ? "toast-info" : "toast-ok");
    toastTimer = setTimeout(() => {
      els.toast.classList.add("hidden");
      els.toast.textContent = "";
    }, 2200);
  }

  function setSaveHint(text, kind) {
    els.saveHint.textContent = text || "";
    els.saveHint.classList.remove("save-ok", "save-err", "save-info");
    if (kind === "ok") els.saveHint.classList.add("save-ok");
    else if (kind === "err") els.saveHint.classList.add("save-err");
    else if (kind === "info") els.saveHint.classList.add("save-info");
  }

  function setSaveButton(state) {
    clearTimeout(saveBtnTimer);
    els.btnSave.classList.remove("btn-save-ok");
    if (state === "saving") {
      els.btnSave.disabled = true;
      els.btnSave.textContent = "保存中…";
      return;
    }
    if (state === "ok") {
      els.btnSave.disabled = false;
      els.btnSave.textContent = "✓ 已保存";
      els.btnSave.classList.add("btn-save-ok");
      saveBtnTimer = setTimeout(() => {
        els.btnSave.textContent = SAVE_BTN_LABEL;
        els.btnSave.classList.remove("btn-save-ok");
      }, 2000);
      return;
    }
    if (state === "err") {
      els.btnSave.disabled = false;
      els.btnSave.textContent = "保存失败";
      saveBtnTimer = setTimeout(() => {
        els.btnSave.textContent = SAVE_BTN_LABEL;
      }, 2000);
      return;
    }
    els.btnSave.disabled = false;
    els.btnSave.textContent = SAVE_BTN_LABEL;
  }

  async function saveCurrent(showFeedback) {
    if (!currentId || saving) return;
    const note = notes.find((n) => n.id === currentId);
    if (!note) return;
    const title = els.noteTitle.value;
    const body = els.noteBody.value;
    const wantFeedback = showFeedback !== false;
    saving = true;
    if (wantFeedback) {
      setSaveButton("saving");
      setSaveHint("正在保存…", "info");
    }
    try {
      const { ok, data } = await api("/api/notes/" + encodeURIComponent(currentId), {
        method: "PUT",
        body: { title, body },
      });
      if (!ok) {
        const err = (data && data.error) || "保存失败";
        if (wantFeedback) {
          setSaveButton("err");
          setSaveHint(err, "err");
          showToast(err, "err");
        } else {
          setSaveHint(err, "err");
        }
        return;
      }
      note.title = data.note.title;
      note.body = data.note.body;
      note.updatedAt = data.note.updatedAt;
      dirty = false;
      if (wantFeedback) {
        setSaveButton("ok");
        setSaveHint("已保存", "ok");
        showToast("已保存", "ok");
        clearTimeout(saveHintTimer);
        saveHintTimer = setTimeout(() => {
          setSaveHint("上次编辑：" + formatTime(note.updatedAt), null);
        }, 2000);
      }
    } catch {
      if (wantFeedback) {
        setSaveButton("err");
        setSaveHint("保存失败，请检查网络", "err");
        showToast("保存失败", "err");
      } else {
        setSaveHint("保存失败，请检查网络", "err");
      }
    } finally {
      saving = false;
      if (!wantFeedback) {
        // silent/background save: restore button if not in a feedback state
        if (els.btnSave.textContent === "保存中…") setSaveButton("idle");
      }
    }
  }

  async function deleteCurrent() {
    if (!currentId) return;
    if (!confirm("确定删除这篇笔记？")) return;
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
    autoTimer = setTimeout(() => saveCurrent(true), 800);
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
    if (dirty) await saveCurrent(false);
    showList();
  });
  els.btnSave.addEventListener("click", () => saveCurrent(true));
  els.btnDelete.addEventListener("click", deleteCurrent);
  els.search.addEventListener("input", () => renderList(els.search.value));
  els.noteTitle.addEventListener("input", scheduleAutosave);
  els.noteBody.addEventListener("input", scheduleAutosave);

  window.addEventListener("pagehide", () => {
    if (dirty && currentId) {
      // best-effort keepalive save
      const title = els.noteTitle.value;
      const body = els.noteBody.value;
      const payload = JSON.stringify({ title, body });
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

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }

  setAuthMode("login");
  boot();
})();
