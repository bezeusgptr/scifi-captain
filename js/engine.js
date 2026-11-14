import { OFFICERS, getOfficer, SKILL_LABELS, cannedReply } from "./officers.js";
import { pickOfflineEvent } from "./events.js";
import { loadSave, writeSave, clearSave, loadSettings, saveSettings, aiConfigured } from "./storage.js";
import { generateEventAI, interpretFreeTextAI, officerChatAI } from "./ai.js";

export { SKILL_LABELS, getOfficer, OFFICERS, aiConfigured };

export const GOAL_LABEL = { arrive: "arrive", scan: "scan", return: "return" };

const SYS_FOR_SKILL = {
  science: "science",
  medicine: "lifeSupport",
  tactics: "weapons",
  piloting: "engines",
  engineering: "engines",
  command: null,
  diplomacy: null,
};

export function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export function formatStardate(n) {
  return Number(n).toFixed(1);
}

export function systemMod(ship, skill) {
  const key = SYS_FOR_SKILL[skill];
  if (!key) return 0;
  const v = ship.systems[key] ?? 100;
  if (v >= 80) return 0;
  if (v >= 50) return -1;
  if (v >= 25) return -2;
  return -3;
}

export function rollCheck(ship, officer, skill, dc) {
  const d20 = 1 + Math.floor(Math.random() * 20);
  const offMod = officer ? officer.stats[skill] || 0 : 0;
  const sys = systemMod(ship, skill);
  const modifier = offMod + sys;
  const total = d20 + modifier;
  let result;
  if (d20 === 1) result = "fail";
  else if (d20 === 20) result = "success";
  else if (total >= dc) result = "success";
  else if (total >= dc - 4) result = "partial";
  else result = "fail";
  return { d20, offMod, sys, modifier, total, dc, result, skill, officerId: officer?.id || null };
}

export function outcomeLabel(result) {
  return result === "success" ? "Успех" : result === "partial" ? "Частичный успех" : "Провал";
}

export function statusWord(v) {
  if (v >= 80) return { key: "ok", text: "штатно" };
  if (v >= 50) return { key: "warn", text: "нестабильно" };
  if (v >= 25) return { key: "bad", text: "повреждено" };
  return { key: "crit", text: "критично" };
}

export function barClass(v) {
  if (v < 30) return "bad";
  if (v < 55) return "warn";
  return "";
}

function defaultMission() {
  return {
    title: "Аномалия Кеплер-442",
    issuedBy: "Штаб Объединённого исследовательского флота",
    briefing:
      "Исследовать гравитационную аномалию в системе Кеплер-442. Собрать полные спектральные данные, установить природу явления и вернуться на станцию «Бастион» с докладом. Избегать вооружённых конфликтов, если это не угрожает безопасности корабля.",
    goals: [
      { id: "arrive", text: "Прибыть в систему Кеплер-442", progress: 0, required: 2, done: false },
      { id: "scan", text: "Провести полное сканирование аномалии", progress: 0, required: 4, done: false },
      { id: "return", text: "Вернуться на станцию «Бастион» с данными", progress: 0, required: 2, done: false },
    ],
    sideQuests: [],
  };
}

function defaultShip() {
  return {
    name: "Странник",
    registry: "НКФ-042",
    crew: 318,
    crewMax: 350,
    fuel: 82,
    hull: 100,
    supplies: 74,
    systems: { engines: 100, lifeSupport: 100, weapons: 96, science: 100 },
  };
}

function defaultRelations() {
  const r = {};
  for (const o of OFFICERS) r[o.id] = 0;
  return r;
}

export function createNewGame() {
  const stardate = 47621.4;
  const state = {
    version: 1,
    phase: "briefing",
    startedAt: Date.now(),
    stardate,
    day: 1,
    ship: defaultShip(),
    mission: defaultMission(),
    relations: defaultRelations(),
    event: null,
    eventHistory: [],
    log: [
      {
        id: 1,
        at: Date.now(),
        stardate,
        author: "Штаб флота",
        authorId: "hq",
        kind: "hq",
        text: "Исследовательский корабль «Странник» (НКФ-042) передаётся под ваше командование. Основной приказ направлен на мостик. Удачи, капитан.",
      },
    ],
    chats: {},
    nextLogId: 2,
    gameOver: null,
  };
  return state;
}

let listeners = new Set();
let state = null;
let settings = loadSettings();
let ticking = null;

export function getState() {
  return state;
}

export function getSettings() {
  return settings;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  if (state) writeSave(state);
  for (const fn of listeners) {
    try {
      fn(state, settings);
    } catch (err) {
      console.error(err);
    }
  }
}

export function initEngine() {
  state = loadSave();
  settings = loadSettings();
  if (state && state.event && state.event.status === "pending" && Date.now() >= state.event.deadline) {
    resolveByXO("timeout-on-load");
  }
  startTicker();
  return state;
}

export function startNewGame() {
  clearSave();
  state = createNewGame();
  emit();
  return state;
}

export function acceptCommand() {
  if (!state || state.phase !== "briefing") return;
  state.phase = "play";
  addLog("hq", "Штаб флота", "Приказ принят. «Странник» выходит на расчётный курс к Кеплер-442.");
  addLog("xo", "Елена Волкова", "Командование принято. Мостик в вашем распоряжении, капитан. Я рядом, если понажусь.");
  emit();
}

export function updateSettings(patch) {
  settings = saveSettings({ ...settings, ...patch });
  emit();
  return settings;
}

function addLog(kind, author, text, authorId) {
  if (!state) return;
  state.log.unshift({
    id: state.nextLogId++,
    at: Date.now(),
    stardate: state.stardate,
    author,
    authorId: authorId || kind,
    kind,
    text,
  });
}

export function addCaptainNote(text) {
  const t = (text || "").trim();
  if (!t) return;
  addLog("captain", "Капитан", t, "captain");
  emit();
}

function applyChanges(changes) {
  if (!changes) return [];
  const ship = state.ship;
  const deltas = [];
  const rec = (label, before, after, unit) => {
    if (after === before) return;
    const d = after - before;
    deltas.push({ label, delta: d, unit: unit || "" });
  };

  if (changes.crew) {
    const b = ship.crew;
    ship.crew = clamp(ship.crew + changes.crew, 0, ship.crewMax);
    rec("Экипаж", b, ship.crew);
  }
  if (changes.fuel) {
    const b = ship.fuel;
    ship.fuel = clamp(ship.fuel + changes.fuel, 0, 100);
    rec("Топливо", b, ship.fuel, "%");
  }
  if (changes.hull) {
    const b = ship.hull;
    ship.hull = clamp(ship.hull + changes.hull, 0, 100);
    rec("Корпус", b, ship.hull, "%");
  }
  if (changes.supplies) {
    const b = ship.supplies;
    ship.supplies = clamp(ship.supplies + changes.supplies, 0, 100);
    rec("Запасы", b, ship.supplies, "%");
  }
  if (changes.systems) {
    const names = { engines: "Двигатели", lifeSupport: "Жизнеобеспечение", weapons: "Вооружение", science: "Научные системы" };
    for (const [k, v] of Object.entries(changes.systems)) {
      if (!v || ship.systems[k] == null) continue;
      const b = ship.systems[k];
      ship.systems[k] = clamp(ship.systems[k] + v, 0, 100);
      rec(names[k] || k, b, ship.systems[k], "%");
    }
  }
  if (changes.relations) {
    for (const [id, v] of Object.entries(changes.relations)) {
      if (!v) continue;
      state.relations[id] = clamp((state.relations[id] || 0) + v, -5, 5);
      const off = getOfficer(id);
      if (off) deltas.push({ label: "Отношение: " + off.name, delta: v });
    }
  }
  if (changes.goals) {
    for (const [id, v] of Object.entries(changes.goals)) {
      if (!v) continue;
      const g = state.mission.goals.find((x) => x.id === id);
      if (!g || g.done) continue;
      const b = g.progress;
      g.progress = clamp(g.progress + v, 0, g.required);
      if (g.progress >= g.required) g.done = true;
      if (g.progress !== b) deltas.push({ label: g.text, delta: g.progress - b, unit: " (прогресс)" });
    }
  }

  maybeAdvanceReturn();
  return deltas;
}

function maybeAdvanceReturn() {
  const arrive = state.mission.goals.find((g) => g.id === "arrive");
  const scan = state.mission.goals.find((g) => g.id === "scan");
  const ret = state.mission.goals.find((g) => g.id === "return");
  if (arrive?.done && scan?.done && ret && !ret.done) {
    ret.progress = clamp(ret.progress + 0.5, 0, ret.required);
    if (ret.progress >= ret.required) ret.done = true;
  }
}

function maybeGameOver() {
  if (!state || state.gameOver) return;
  if (state.ship.hull <= 0) {
    state.gameOver = {
      title: "Корабль потерян",
      text: "Корпус «Странника» не выдержал. Кампания на этом заканчивается — по крайней мере, эта.",
    };
  } else if (state.ship.crew <= 0) {
    state.gameOver = {
      title: "Экипаж потерян",
      text: "На борту не осталось людей, способных держать корабль. История «Странника» обрывается.",
    };
  } else if (state.ship.fuel <= 0 && state.ship.systems.engines <= 0) {
    state.gameOver = {
      title: "Дрейф без хода",
      text: "Топливо и двигатели кончились разом. «Странник» дрейфует в тишине, ожидая, кого штаб пришлёт слишком поздно.",
    };
  } else if (state.mission.goals.every((g) => g.done)) {
    state.gameOver = {
      title: "Приказ выполнен",
      text: "Данные об аномалии доставлены на «Бастион». Штаб принимает доклад. Это победа — пока не пришёл следующий приказ.",
      victory: true,
    };
  }
}

function instantiateEvent(ev, timerSec) {
  const now = Date.now();
  const sec = Math.max(5, Number(timerSec) || 180);
  return {
    ...ev,
    instanceId: "e-" + now.toString(36) + "-" + Math.floor(Math.random() * 1e4).toString(36),
    startedAt: now,
    deadline: now + sec * 1000,
    timerSec: sec,
    status: "pending",
    resolution: null,
  };
}

export async function startEvent({ forceId, preferAi = true } = {}) {
  if (!state || state.phase !== "play" || state.gameOver) return { ok: false, reason: "not-playable" };
  if (state.event && state.event.status === "pending") return { ok: false, reason: "active" };

  let ev = null;
  let usedAi = false;
  let aiError = null;
  if (preferAi && aiConfigured(settings)) {
    try {
      ev = await generateEventAI(state, settings);
      usedAi = true;
    } catch (err) {
      aiError = err.message || String(err);
      ev = null;
    }
  }
  if (!ev) ev = pickOfflineEvent(state, forceId);
  ev.source = usedAi ? "ai" : ev.source || "offline";

  state.stardate = Math.round((state.stardate + 0.15) * 10) / 10;
  state.day += 1;
  if (state.ship.fuel > 0) state.ship.fuel = clamp(state.ship.fuel - 2, 0, 100);

  state.event = instantiateEvent(ev, settings.timerSec);
  if (!state.eventHistory.includes(ev.id)) state.eventHistory.push(ev.id);
  addLog("system", "Датчики мостика", `Зафиксировано событие: «${ev.title}». Ожидается решение капитана.`);
  maybeGameOver();
  emit();
  return { ok: true, event: state.event, usedAi, aiError };
}

function resolveWith(option, source, freeText) {
  if (!state?.event || state.event.status !== "pending") return null;
  const ev = state.event;
  const skill = option.skill || ev.skill || "command";
  const dc = ev.difficulty + (option.dcMod || 0);
  const officer = getOfficer(option.officerId) || (skill ? OFFICERS.find((o) => (o.stats[skill] || 0) >= 4) : getOfficer("xo"));
  const roll = rollCheck(state.ship, officer, skill, dc);
  const branch = option.outcomes?.[roll.result] || option.outcomes?.partial || option.outcomes?.fail;
  const deltas = applyChanges(branch?.changes);
  if (option.favor || option.disfavor) {
    const rel = {};
    for (const id of option.favor || []) rel[id] = (rel[id] || 0) + 1;
    for (const id of option.disfavor || []) rel[id] = (rel[id] || 0) - 1;
    // already applied if in changes; apply leftover only if not present
    const extra = { relations: {} };
    for (const [id, v] of Object.entries(rel)) {
      if (!branch?.changes?.relations?.[id]) extra.relations[id] = v;
    }
    if (Object.keys(extra.relations).length) deltas.push(...applyChanges(extra));
  }
  if (option.sideQuest || branch?.sideQuest) {
    const q = option.sideQuest || branch.sideQuest;
    if (q && !state.mission.sideQuests.some((s) => s.id === q.id)) {
      state.mission.sideQuests.push({ ...q, done: roll.result === "success" });
    } else if (q) {
      const exist = state.mission.sideQuests.find((s) => s.id === q.id);
      if (exist && roll.result === "success") exist.done = true;
    }
  }

  const who = source === "xo" ? "Старпом Елена Волкова" : "Капитан";
  const kind = source === "xo" ? "xo" : "captain";
  const choiceText = freeText ? `свой вариант: «${freeText}»` : option.text;
  const prefix = source === "xo"
    ? `Старпом Волкова приняла решение в отсутствие капитана: ${option.text}`
    : `Капитан отдал приказ: ${choiceText}`;
  const logLine = `${prefix} Проверка: ${SKILL_LABELS[skill] || skill} ${roll.d20}${roll.modifier >= 0 ? "+" : ""}${roll.modifier} = ${roll.total} против Сл ${roll.dc} — ${outcomeLabel(roll.result)}. ${branch?.log || ""}`;
  addLog(kind, who, logLine.trim(), source === "xo" ? "xo" : "captain");
  if (officer && officer.id !== "xo") {
    const comment =
      roll.result === "success"
        ? "Как и рассчитывали."
        : roll.result === "partial"
          ? "Вышло не идеально, но мы на ногах."
          : "Этот исход мне не нравится.";
    addLog("officer", officer.name, comment, officer.id);
  }

  ev.status = "resolved";
  ev.resolution = {
    source,
    optionId: option.id,
    optionText: option.text,
    freeText: freeText || null,
    roll,
    result: roll.result,
    narration: branch?.narration || "",
    log: branch?.log || "",
    deltas,
    officerId: officer?.id || null,
  };
  maybeGameOver();
  if (state.gameOver) {
    addLog("hq", "Штаб флота", state.gameOver.title + ". " + state.gameOver.text);
  }
  emit();
  return ev.resolution;
}

export function resolveOption(optionId, source = "captain") {
  const ev = state?.event;
  if (!ev || ev.status !== "pending") return null;
  const option = ev.options.find((o) => o.id === optionId);
  if (!option) return null;
  return resolveWith(option, source, null);
}

function scoreOptionForXO(option, ev) {
  const fail = option.outcomes?.fail?.changes || {};
  const risk = Math.abs(fail.hull || 0) + Math.abs(fail.crew || 0) * 2 + Math.abs(fail.systems?.engines || 0);
  const dc = ev.difficulty + (option.dcMod || 0);
  let score = 30 - risk - dc;
  // cautious XO prefers command/piloting/engineering, dislikes reckless science/tactics if fail is harsh
  if (["command", "piloting", "engineering", "medicine"].includes(option.skill)) score += 4;
  if (option.officerId === "xo") score += 6;
  if (option.officerId === "tactical" || option.officerId === "science") score -= 1;
  return score;
}

export function resolveByXO(_reason) {
  const ev = state?.event;
  if (!ev || ev.status !== "pending") return null;
  const opts = ev.options || [];
  if (!opts.length) return null;
  const rollPick = Math.random();
  let option;
  if (rollPick < 0.35) {
    option = opts[Math.floor(Math.random() * opts.length)];
  } else if (rollPick < 0.5) {
    option = opts.find((o) => o.officerId === "tactical") || opts[opts.length - 1];
  } else {
    option = [...opts].sort((a, b) => scoreOptionForXO(b, ev) - scoreOptionForXO(a, ev))[0];
  }
  return resolveWith(option, "xo", null);
}

function keywordScore(text, option) {
  const t = text.toLowerCase();
  const words = (option.text + " " + (option.skill || "")).toLowerCase().split(/[^а-яa-z0-9]+/i).filter((w) => w.length > 3);
  let s = 0;
  for (const w of words) if (t.includes(w)) s += 1;
  const hints = {
    science: ["скан", "наук", "датчик", "исслед", "данн", "гипотез"],
    tactics: ["щит", "оруд", "бой", "готовн", "огонь", "залп"],
    piloting: ["курс", "манёвр", "маневр", "обход", "рул", "дистанц"],
    engineering: ["ремонт", "двигат", "почин", "фильтр", "инжен"],
    medicine: ["лечен", "карантин", "изол", "врач", "экипаж", "лазарет"],
    command: ["приказ", "передать", "штаб", "перегов"],
    diplomacy: ["связь", "привет", "мирн", "перегов", "контакт"],
  };
  for (const w of hints[option.skill] || []) if (t.includes(w)) s += 2;
  return s;
}

function genericFreeTextOption(text, ev) {
  const short = text.length > 160 ? text.slice(0, 157) + "…" : text;
  return {
    id: "free-text",
    text: short,
    skill: ev.skill || "command",
    officerId: "xo",
    favor: [],
    disfavor: [],
    outcomes: {
      success: {
        narration: `Экипаж понимает нестандартный приказ и выполняет его достаточно чисто. Замысел капитана («${short}») вписывается в обстоятельства и даёт результат.`,
        log: "Нестандартный приказ капитана выполнен успешно.",
        changes: { fuel: -3, supplies: -2, goals: ev.skill === "science" ? { scan: 0.5 } : {} },
      },
      partial: {
        narration: `Приказ («${short}») выполняют, но выходит шероховато: часть задуманного срабатывает, часть приходится добирать по месту.`,
        log: "Нестандартный приказ капитана выполнен частично.",
        changes: { fuel: -5, supplies: -3 },
      },
      fail: {
        narration: `Нестандартный замысел («${short}») сталкивается с реальностью и не срабатывает. Корабль отделывается умеренными потерями — к счастью, не катастрофой.`,
        log: "Нестандартный приказ капитана не удался.",
        changes: { fuel: -6, hull: -6, supplies: -3 },
      },
    },
  };
}

export async function resolveFreeText(text) {
  const ev = state?.event;
  if (!ev || ev.status !== "pending") return null;
  const t = (text || "").trim();
  if (!t) return null;

  if (aiConfigured(settings)) {
    try {
      const inter = await interpretFreeTextAI(state, settings, t, ev);
      const option = {
        id: "free-text",
        text: t,
        skill: inter.skill,
        officerId: inter.officerId,
        outcomes: inter.outcomes,
      };
      return resolveWith(option, "captain", t);
    } catch (err) {
      console.warn("free-text AI failed", err);
    }
  }

  let best = null;
  let bestScore = 1;
  for (const o of ev.options || []) {
    const s = keywordScore(t, o);
    if (s > bestScore) {
      bestScore = s;
      best = o;
    }
  }
  const option = best
    ? { ...best, text: best.text, _matched: true }
    : genericFreeTextOption(t, ev);
  return resolveWith(option, "captain", t);
}

export function dismissEvent() {
  if (state?.event && state.event.status === "resolved") {
    state.event = null;
    emit();
  }
}

export async function talkToOfficer(officerId, text) {
  const officer = getOfficer(officerId);
  const t = (text || "").trim();
  if (!officer || !t || !state) return null;
  if (!state.chats[officerId]) state.chats[officerId] = [];
  const history = state.chats[officerId];
  history.push({ role: "me", text: t, at: Date.now() });
  let reply;
  let usedAi = false;
  if (aiConfigured(settings)) {
    try {
      reply = await officerChatAI(state, settings, officer, t, history);
      usedAi = true;
    } catch (err) {
      reply = cannedReply(officer, state, t);
    }
  } else {
    reply = cannedReply(officer, state, t);
  }
  history.push({ role: "them", text: reply, at: Date.now(), usedAi });
  emit();
  return { reply, usedAi };
}

export function eventRemainingMs() {
  const ev = state?.event;
  if (!ev || ev.status !== "pending") return 0;
  return Math.max(0, ev.deadline - Date.now());
}

function startTicker() {
  if (ticking) clearInterval(ticking);
  ticking = setInterval(() => {
    if (!state?.event || state.event.status !== "pending") return;
    if (Date.now() >= state.event.deadline) {
      resolveByXO("timer");
    } else {
      for (const fn of listeners) {
        try {
          fn(state, settings, { tick: true });
        } catch {}
      }
    }
  }, 250);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state?.event?.status === "pending" && Date.now() >= state.event.deadline) {
      resolveByXO("visibility");
    }
  });
}

export function formatTimer(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return String(m).padStart(2, "0") + ":" + String(r).padStart(2, "0");
}

export function relationWord(v) {
  if (v >= 3) return "уважает вас";
  if (v >= 1) return "на вашей стороне";
  if (v <= -3) return "в обиде";
  if (v <= -1) return "сомневается";
  return "нейтрально";
}
