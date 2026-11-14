import { OFFICERS, SKILL_LABELS } from "./officers.js";

function extractJson(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : text;
  const start = raw.search(/[{\[]/);
  if (start < 0) return null;
  let sliced = raw.slice(start).trim();
  sliced = sliced.replace(/,\s*([}\]])/g, "$1");
  try {
    return JSON.parse(sliced);
  } catch {
    const endCurly = sliced.lastIndexOf("}");
    const endBrack = sliced.lastIndexOf("]");
    const end = Math.max(endCurly, endBrack);
    if (end > 0) {
      try {
        return JSON.parse(sliced.slice(0, end + 1).replace(/,\s*([}\]])/g, "$1"));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function endpoint(baseUrl) {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.endsWith("/chat/completions")) return base;
  if (base.endsWith("/v1")) return base + "/chat/completions";
  return base + "/v1/chat/completions";
}

export async function chatCompletion(settings, messages, { json = true, timeoutMs = 45000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const headers = { "Content-Type": "application/json" };
  if (settings.apiKey) headers.Authorization = "Bearer " + settings.apiKey.trim();

  const body = {
    model: settings.model.trim(),
    messages,
    temperature: 0.8,
  };
  if (json) body.response_format = { type: "json_object" };

  const url = endpoint(settings.apiBaseUrl.trim());
  try {
    let res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: ctrl.signal });
    if (!res.ok && json) {
      delete body.response_format;
      res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: ctrl.signal });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.error?.message || data.message || res.status + " " + res.statusText;
      throw new Error(msg);
    }
    const text = data.choices?.[0]?.message?.content || data.message?.content || "";
    if (!json) return { text, raw: data };
    const parsed = extractJson(text);
    if (!parsed) throw new Error("Модель вернула не JSON");
    return { json: parsed, text, raw: data };
  } finally {
    clearTimeout(t);
  }
}

export async function testConnection(settings) {
  const result = await chatCompletion(
    settings,
    [
      { role: "system", content: "Ответь строго JSON-объектом." },
      { role: "user", content: 'Верни {"ok": true, "pong": "капитан"} и больше ничего.' },
    ],
    { json: true, timeoutMs: 20000 }
  );
  return result.json;
}

function worldDigest(state) {
  const s = state.ship;
  const officers = OFFICERS.map((o) => {
    const rel = state.relations?.[o.id] ?? 0;
    return `${o.rank} ${o.name} (${o.role}, ${o.traits.join(", ")}; отношение ${rel}; навыки: ${Object.entries(o.stats).map(([k, v]) => `${SKILL_LABELS[k]} ${v}`).join(", ")})`;
  }).join("\n");
  const goals = state.mission.goals.map((g) => `- ${g.text}: ${g.progress}/${g.required}${g.done ? " (выполнено)" : ""}`).join("\n");
  const sides = (state.mission.sideQuests || []).map((q) => `- ${q.title}${q.done ? " (закрыт)" : ""}`).join("\n") || "нет";
  const recent = (state.log || []).slice(0, 8).map((l) => `[${l.stardate}] ${l.author}: ${l.text}`).join("\n");
  return `Корабль: ${s.name} (${s.registry})
Звёздная дата: ${state.stardate}
Экипаж: ${s.crew}/${s.crewMax}
Топливо: ${s.fuel}
Корпус: ${s.hull}
Запасы: ${s.supplies}
Системы: двигатели ${s.systems.engines}, жизнеобеспечение ${s.systems.lifeSupport}, вооружение ${s.systems.weapons}, наука ${s.systems.science}

Основной приказ: ${state.mission.briefing}
Цели:
${goals}
Побочные задачи:
${sides}

Офицеры:
${officers}

Последние записи журнала:
${recent || "пусто"}`;
}

const EVENT_SCHEMA = `Верни JSON-объект такой формы:
{
  "title": "короткий заголовок",
  "description": "2-4 предложения, что произошло",
  "difficulty": 12,
  "skill": "science|medicine|tactics|piloting|engineering|command|diplomacy",
  "advice": [{"officerId": "xo|science|medical|tactical|navigation|engineering", "text": "совет от лица офицера"}],
  "options": [
    {
      "id": "a",
      "text": "вариант действия капитана",
      "skill": "science",
      "officerId": "science",
      "favor": ["science"],
      "disfavor": ["tactical"],
      "outcomes": {
        "success": {"narration": "что видит капитан", "log": "краткая запись в журнал", "changes": {"fuel": -5, "hull": 0, "crew": 0, "supplies": 0, "systems": {"engines": 0}, "relations": {"science": 1}, "goals": {"arrive": 0, "scan": 0, "return": 0}}},
        "partial": {"narration": "", "log": "", "changes": {}},
        "fail": {"narration": "", "log": "", "changes": {}}
      }
    }
  ]
}
Правила: текст только по-русски. 3 варианта, советы минимум от 3 офицеров, они СПОРЯТ. changes — целые числа, умеренные (обычно от -16 до +12). Топливо тратится умеренно: обычно от -1 до -6 за событие, не больше -8. Если топлива мало (меньше 35), чаще давай вариант дозаправиться (станция, газовый гигант, танкер, торговля) с fuel от +8 до +20. Без топлива миссия проваливается. Не убивай кампанию без нужды. Не повторяй недавние события журнала. difficulty от 8 до 18.`;

export async function generateEventAI(state, settings) {
  const { json } = await chatCompletion(settings, [
    {
      role: "system",
      content:
        "Ты мастер научно-фантастической игры в духе Star Trek с элементами D&D. Игрок — капитан корабля «Странник». Придумывай новые события на пути выполнения приказа. Правила и броски считает программа, ты только описываешь ситуацию, советы офицеров и ветки последствий. Офицеры остаются в характере.",
    },
    { role: "user", content: worldDigest(state) + "\n\nСгенерируй ОДНО новое случайное событие.\n" + EVENT_SCHEMA },
  ]);
  return repairEvent(json);
}

export async function interpretFreeTextAI(state, settings, text, event) {
  const { json } = await chatCompletion(settings, [
    {
      role: "system",
      content:
        "Ты мастер игры. Капитан написал свой вариант действий. Впиши его в мир без противоречий. Правила и кубик считает программа: верни skill, difficulty и три ветки последствий (success, partial, fail).",
    },
    {
      role: "user",
      content:
        worldDigest(state) +
        `\n\nТекущее событие: ${event.title}\n${event.description}\n\nПриказ капитана свободным текстом:\n«${text}»\n\nВерни JSON:\n{"skill":"command","difficulty":13,"officerId":"xo","outcomes":{"success":{"narration":"","log":"","changes":{}},"partial":{"narration":"","log":"","changes":{}},"fail":{"narration":"","log":"","changes":{}}}}\nВсе тексты по-русски. changes в той же схеме, что у событий.`,
    },
  ]);
  return repairFreeText(json, event, text);
}

export async function officerChatAI(state, settings, officer, userText, history) {
  const lines = (history || [])
    .slice(-8)
    .map((m) => (m.role === "me" ? "Капитан" : officer.name) + ": " + m.text)
    .join("\n");
  const { json } = await chatCompletion(settings, [
    {
      role: "system",
      content: `Ты играешь старшего офицера корабля «Странник». Оставайся в характере, говори по-русски, коротко (2-5 предложений), без мета-комментариев и без markdown.\nТы: ${officer.rank} ${officer.name}, ${officer.role}. Черты: ${officer.traits.join(", ")}.\nБиография: ${officer.bio}`,
    },
    {
      role: "user",
      content:
        worldDigest(state) +
        `\n\nНедавний разговор:\n${lines || "(начало разговора)"}\n\nРеплика капитана: «${userText}»\nВерни JSON {"reply": "ответ офицера"}.`,
    },
  ]);
  const reply = (json && (json.reply || json.text || json.message)) || "";
  if (!String(reply).trim()) throw new Error("Пустой ответ модели");
  return String(reply).trim();
}

const SKILLS = Object.keys(SKILL_LABELS);
const OIDS = OFFICERS.map((o) => o.id);

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : d;
}

function clampChanges(ch) {
  const out = { crew: 0, fuel: 0, hull: 0, supplies: 0, systems: {}, relations: {}, goals: {} };
  if (!ch || typeof ch !== "object") return out;
  for (const k of ["crew", "fuel", "hull", "supplies"]) out[k] = Math.max(-25, Math.min(25, num(ch[k])));
  out.fuel = Math.max(-8, Math.min(20, out.fuel));
  if (ch.systems && typeof ch.systems === "object") {
    for (const k of ["engines", "lifeSupport", "weapons", "science"]) {
      if (ch.systems[k] != null) out.systems[k] = Math.max(-25, Math.min(25, num(ch.systems[k])));
    }
  }
  if (ch.relations && typeof ch.relations === "object") {
    for (const k of Object.keys(ch.relations)) {
      if (OIDS.includes(k)) out.relations[k] = Math.max(-3, Math.min(3, num(ch.relations[k])));
    }
  }
  if (ch.goals && typeof ch.goals === "object") {
    for (const k of ["arrive", "scan", "return"]) {
      if (ch.goals[k] != null) out.goals[k] = Math.max(0, Math.min(2, Number(ch.goals[k]) || 0));
    }
  }
  return out;
}

function repairOutcome(o, fallbackNarr, fallbackLog) {
  o = o && typeof o === "object" ? o : {};
  return {
    narration: String(o.narration || o.text || fallbackNarr),
    log: String(o.log || o.journal || fallbackLog),
    changes: clampChanges(o.changes),
  };
}

export function repairEvent(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Пустое событие");
  const ev = {
    id: String(raw.id || ("ai-" + Date.now().toString(36))),
    title: String(raw.title || "Неизвестное происшествие").slice(0, 80),
    description: String(raw.description || raw.text || "На мостике не могут кратко сформулировать, что случилось.").slice(0, 800),
    difficulty: Math.max(6, Math.min(20, num(raw.difficulty, 12))),
    skill: SKILLS.includes(raw.skill) ? raw.skill : "command",
    advice: [],
    options: [],
    source: "ai",
  };
  const advice = Array.isArray(raw.advice) ? raw.advice : [];
  for (const a of advice) {
    const id = OIDS.includes(a.officerId) ? a.officerId : OIDS.includes(a.id) ? a.id : null;
    if (!id || !a.text) continue;
    ev.advice.push({ officerId: id, text: String(a.text).slice(0, 400) });
  }
  if (ev.advice.length < 2) {
    ev.advice = [
      { officerId: "xo", text: "Предлагаю действовать осторожно и не рисковать экипажем без нужды." },
      { officerId: "tactical", text: "Я бы держал орудия и щиты наготове, пока не станет ясно, с чем мы имеем дело." },
      { officerId: "science", text: "Нужны данные. Давайте не упустим шанс понять явление." },
    ];
  }
  const opts = Array.isArray(raw.options) ? raw.options : [];
  opts.slice(0, 4).forEach((o, i) => {
    if (!o || !o.text) return;
    const skill = SKILLS.includes(o.skill) ? o.skill : ev.skill;
    const officerId = OIDS.includes(o.officerId) ? o.officerId : null;
    ev.options.push({
      id: String(o.id || ("opt-" + i)),
      text: String(o.text).slice(0, 180),
      skill,
      officerId,
      favor: Array.isArray(o.favor) ? o.favor.filter((x) => OIDS.includes(x)) : officerId ? [officerId] : [],
      disfavor: Array.isArray(o.disfavor) ? o.disfavor.filter((x) => OIDS.includes(x)) : [],
      outcomes: {
        success: repairOutcome(o.outcomes?.success, "Задуманное удаётся.", "Действие капитана увенчалось успехом."),
        partial: repairOutcome(o.outcomes?.partial, "Получилось лишь отчасти.", "Действие капитана дало частичный результат."),
        fail: repairOutcome(o.outcomes?.fail, "Обстоятельства оказались сильнее замысла.", "Действие капитана не удалось."),
      },
    });
  });
  if (ev.options.length < 2) throw new Error("Модель не вернула достаточно вариантов");
  return ev;
}

export function repairFreeText(raw, event, text) {
  raw = raw && typeof raw === "object" ? raw : {};
  const skill = SKILLS.includes(raw.skill) ? raw.skill : event.skill || "command";
  const difficulty = Math.max(6, Math.min(20, num(raw.difficulty, event.difficulty || 13)));
  const officerId = OIDS.includes(raw.officerId) ? raw.officerId : "xo";
  const oc = raw.outcomes || {};
  return {
    skill,
    difficulty,
    officerId,
    outcomes: {
      success: repairOutcome(oc.success, `Нестандартный приказ срабатывает: «${text}».`, "Капитан отдал нестандартный приказ, и он сработал."),
      partial: repairOutcome(oc.partial, `Приказ выполняют с оговорками: «${text}».`, "Нестандартный приказ капитана выполнен частично."),
      fail: repairOutcome(oc.fail, `Замысел не срабатывает: «${text}».`, "Нестандартный приказ капитана не удался."),
    },
  };
}
