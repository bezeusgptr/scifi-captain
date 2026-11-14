import {
  initEngine, getState, getSettings, subscribe, acceptCommand, startNewGame,
  startEvent, resolveOption, resolveFreeText, resolveByXO, dismissEvent,
  addCaptainNote, talkToOfficer, updateSettings, eventRemainingMs, refuel,
} from "./engine.js";
import { testConnection } from "./ai.js";
import { renderScreen, updateTimersInPlace } from "./ui.js";

const TITLES = {
  briefing: "Капитан на удалёнке",
  bridge: "Пульт",
  event: "Событие",
  mission: "Миссия",
  log: "Судовой журнал",
  officers: "Офицеры",
  officer: "Офицер",
  ship: "Корабль",
  settings: "Настройки",
};

let screen = "bridge";
let params = {};
let busy = false;
let lastNotifiedEvent = null;

function routeFromHash() {
  const raw = (location.hash || "").replace(/^#\/?/, "");
  const [name, qs] = raw.split("?");
  const q = new URLSearchParams(qs || "");
  const known = ["bridge", "event", "mission", "log", "officers", "officer", "ship", "settings"];
  if (known.includes(name)) {
    screen = name;
    params = Object.fromEntries(q.entries());
  } else {
    screen = "bridge";
    params = {};
  }
}

function hashFor(name, p = {}) {
  if (name === "bridge" || !name) return "#/bridge";
  const q = new URLSearchParams(p).toString();
  return `#/${name}${q ? "?" + q : ""}`;
}

export function go(name, p = {}, { replace = false } = {}) {
  const st = getState();
  if (st?.phase === "briefing" && name !== "briefing") return;
  const url = hashFor(name, p);
  if (replace) history.replaceState({ screen: name, params: p }, "", url);
  else history.pushState({ screen: name, params: p }, "", url);
  screen = name;
  params = p;
  hideToast();
  paint();
}

function back() {
  if (window.history.length > 1) {
    history.back();
    return;
  }
  if (screen === "officer") {
    go("officers", {}, { replace: true });
    return;
  }
  if (screen !== "bridge" && screen !== "briefing") {
    go("bridge", {}, { replace: true });
  }
}

function paint({ tick = false } = {}) {
  const root = document.getElementById("app");
  const st = getState();
  if (!st) return;
  if (st.phase === "briefing") {
    screen = "briefing";
  } else if (screen === "briefing") {
    screen = "bridge";
  }
  if (tick) {
    updateTimersInPlace();
    return;
  }
  const html = renderScreen(screen, params);
  root.innerHTML = html;
  root.classList.toggle("busy", busy);
  document.title = (TITLES[screen] || "Капитан") + " · «" + st.ship.name + "»";
  const chat = document.getElementById("chat-log");
  if (chat) chat.scrollTop = chat.scrollHeight;
}

function hideToast() {
  const el = document.querySelector(".toast");
  if (!el) return;
  el.classList.remove("show");
  clearTimeout(el._t);
}

function toast(text, ms = 2400) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), ms);
}

async function notifyEvent(ev, { silentUi = false } = {}) {
  if (!ev || ev.instanceId === lastNotifiedEvent) return;
  lastNotifiedEvent = ev.instanceId;
  if (!silentUi) toast("Новое событие: " + ev.title, 4000);
  if (navigator.vibrate) {
    try { navigator.vibrate([40, 40, 80]); } catch {}
  }
  const s = getSettings();
  if (!s.notify || !("Notification" in window) || Notification.permission !== "granted") return;
  const body = ev.title + ". Решение нужно до истечения таймера.";
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg?.showNotification) {
      await reg.showNotification("Странник: событие на мостике", {
        body,
        icon: "icons/icon-192.png",
        badge: "icons/icon-192.png",
        tag: "scifi-event",
        data: { screen: "event" },
      });
    } else {
      new Notification("Странник: событие на мостике", { body, icon: "icons/icon-192.png", tag: "scifi-event" });
    }
  } catch {
    try { new Notification("Странник: событие на мостике", { body, icon: "icons/icon-192.png" }); } catch {}
  }
}

async function withBusy(fn) {
  if (busy) return;
  busy = true;
  document.getElementById("app")?.classList.add("busy");
  try {
    return await fn();
  } finally {
    busy = false;
    document.getElementById("app")?.classList.remove("busy");
  }
}

async function doContinue() {
  await withBusy(async () => {
    const btn = document.getElementById("btn-continue");
    if (btn) btn.textContent = "Датчики работают…";
    const res = await startEvent();
    if (!res?.ok) {
      if (res?.reason === "active") toast("Сначала разберите текущее событие.");
      else toast("Сейчас нельзя продолжить полёт.");
      paint();
      return;
    }
    if (res.aiError) toast("Мастер ИИ не ответил, взято встроенное событие.");
    await notifyEvent(res.event, { silentUi: true });
    go("event");
  });
}

async function onAction(act, el, ev) {
  if (act === "back") {
    back();
    return;
  }
  if (act === "go") {
    go(el.dataset.screen, el.dataset.id ? { id: el.dataset.id } : {});
    return;
  }
  if (act === "accept") {
    acceptCommand();
    go("bridge", {}, { replace: true });
    toast("Командование принято. Добро пожаловать на мостик.");
    return;
  }
  if (act === "continue") {
    ev.preventDefault();
    await doContinue();
    return;
  }
  if (act === "refuel") {
    refuel();
    paint();
    return;
  }
  if (act === "choose") {
    const r = resolveOption(el.dataset.id, "captain");
    if (r) paint();
    return;
  }
  if (act === "freetext") {
    const area = document.getElementById("free-text");
    const text = area?.value || "";
    if (!text.trim()) {
      toast("Сначала напишите свой вариант.");
      return;
    }
    await withBusy(async () => {
      if (area) area.disabled = true;
      const r = await resolveFreeText(text);
      if (!r) toast("Сейчас нет активного события.");
      paint();
    });
    return;
  }
  if (act === "dismiss") {
    dismissEvent();
    go("bridge", {}, { replace: true });
    return;
  }
  if (act === "note") {
    const area = document.getElementById("captain-note");
    addCaptainNote(area?.value || "");
    toast("Запись добавлена в журнал.");
    return;
  }
  if (act === "officer") {
    go("officer", { id: el.dataset.id });
    return;
  }
  if (act === "timer-preset") {
    updateSettings({ timerSec: Number(el.dataset.sec) });
    const input = document.getElementById("set-timer");
    if (input) input.value = el.dataset.sec;
    toast("Таймер: " + el.dataset.sec + " с.");
    return;
  }
  if (act === "save-ai") {
    const timer = Number(document.getElementById("set-timer")?.value) || getSettings().timerSec;
    updateSettings({
      timerSec: Math.max(5, Math.min(10800, timer)),
      apiBaseUrl: document.getElementById("set-url")?.value.trim() || "",
      apiKey: document.getElementById("set-key")?.value.trim() || "",
      model: document.getElementById("set-model")?.value.trim() || "gpt-4o-mini",
    });
    toast("Настройки сохранены.");
    paint();
    return;
  }
  if (act === "test-ai") {
    const box = document.getElementById("ai-msg");
    const timer = Number(document.getElementById("set-timer")?.value) || getSettings().timerSec;
    updateSettings({
      timerSec: Math.max(5, Math.min(10800, timer)),
      apiBaseUrl: document.getElementById("set-url")?.value.trim() || "",
      apiKey: document.getElementById("set-key")?.value.trim() || "",
      model: document.getElementById("set-model")?.value.trim() || "gpt-4o-mini",
    });
    const s = getSettings();
    if (!s.apiBaseUrl || !s.apiKey) {
      if (box) box.innerHTML = `<p class="error-box">Нужны адрес и ключ.</p>`;
      return;
    }
    if (box) box.innerHTML = `<p class="muted small">Проверяю связь…</p>`;
    try {
      const r = await testConnection(s);
      if (box) box.innerHTML = `<p class="ok-box">Связь есть. Ответ: ${JSON.stringify(r)}</p>`;
    } catch (err) {
      if (box) box.innerHTML = `<p class="error-box">Не удалось: ${String(err.message || err)}</p>`;
    }
    return;
  }
  if (act === "notify") {
    if (!("Notification" in window)) {
      toast("Этот браузер не умеет системные уведомления.");
      return;
    }
    const perm = await Notification.requestPermission();
    updateSettings({ notify: perm === "granted" });
    toast(perm === "granted" ? "Уведомления включены." : "Разрешение не получено.");
    paint();
    return;
  }
  if (act === "reset") {
    if (!confirm("Сбросить кампанию и начать заново? Ключ API сохранится.")) return;
    startNewGame();
    go("bridge", {}, { replace: true });
    paint();
    toast("Новая кампания начата.");
    return;
  }
}

function bind() {
  document.addEventListener("click", (ev) => {
    const el = ev.target.closest("[data-act]");
    if (!el) return;
    if (el.tagName === "FORM") return;
    onAction(el.dataset.act, el, ev);
  });
  document.addEventListener("submit", async (ev) => {
    const form = ev.target.closest("[data-act=chatform]");
    if (!form) return;
    ev.preventDefault();
    const input = document.getElementById("chat-input");
    const text = input?.value || "";
    if (!text.trim()) return;
    const id = form.dataset.id;
    if (input) input.value = "";
    await withBusy(async () => {
      await talkToOfficer(id, text);
      paint();
    });
  });
  window.addEventListener("popstate", () => {
    routeFromHash();
    const st = getState();
    if (st?.phase === "briefing") screen = "briefing";
    paint();
  });
  window.addEventListener("hashchange", () => {
    routeFromHash();
    paint();
  });
}

async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js");
    navigator.serviceWorker.addEventListener("message", (ev) => {
      if (ev.data?.type === "open-event") go("event");
    });
  } catch (err) {
    console.warn("SW failed", err);
  }
}

function boot() {
  initEngine();
  bind();
  routeFromHash();
  const st = getState();
  if (!st) {
    startNewGame();
  }
  if (getState().phase === "briefing") {
    history.replaceState({ screen: "briefing" }, "", "#/briefing");
    screen = "briefing";
  } else if (!location.hash) {
    history.replaceState({ screen: "bridge" }, "", "#/bridge");
    screen = "bridge";
  }
  subscribe((_s, _set, meta) => {
    if (meta?.tick) {
      paint({ tick: true });
      return;
    }
    paint();
  });
  paint();
  registerSW();
  window.__game = {
    getState, getSettings, go, startEvent, startNewGame, resolveOption,
    resolveFreeText, resolveByXO, dismissEvent, acceptCommand, updateSettings,
    talkToOfficer, eventRemainingMs, refuel,
  };
}

boot();
