import {
  getState, getSettings, eventRemainingMs, formatTimer, formatStardate,
  SKILL_LABELS, getOfficer, OFFICERS, statusWord, barClass, outcomeLabel,
  relationWord, aiConfigured, systemMod,
} from "./engine.js";
import { DEPARTMENTS, initials } from "./officers.js";

export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SYS = [
  ["engines", "Двигатели"],
  ["lifeSupport", "Жизнеобеспечение"],
  ["weapons", "Вооружение"],
  ["science", "Научные системы"],
];

function resBar(label, val, extra) {
  const cls = barClass(val);
  return `<div class="res-row">
    <span class="lbl">${esc(label)}</span>
    <div class="bar ${cls}"><i style="width:${clampPct(val)}%"></i></div>
    <span class="val">${esc(extra ?? (val + "%"))}</span>
  </div>`;
}

function clampPct(v) { return Math.max(0, Math.min(100, Number(v) || 0)); }

function header(title, { back = true, alert = false } = {}) {
  const st = getState();
  const ev = st?.event;
  const alertOn = ev && ev.status === "pending";
  return `
    <div class="status-bar ${alertOn || alert ? "alert" : ""}">
      <span><span class="dot"></span><span class="ship">${esc(st.ship.name)}</span> · ${esc(st.ship.registry)}</span>
      <span>ЗС ${esc(formatStardate(st.stardate))}</span>
    </div>
    <div class="scr-head">
      ${back ? `<button class="btn-back" type="button" data-act="back" aria-label="Назад">←</button>` : `<span style="width:8px"></span>`}
      <h1>${esc(title)}</h1>
    </div>`;
}

export function renderBriefing(st) {
  return `<div class="briefing screen" data-screen="briefing">
    <div class="seal">Объединённый исследовательский флот</div>
    <div class="panel">
      <div class="kicker">Входящий приказ · секретно</div>
      <h2>${esc(st.mission.title)}</h2>
      <p class="small muted" style="margin-bottom:10px">${esc(st.mission.issuedBy)}</p>
      <p>${esc(st.mission.briefing)}</p>
      <div class="hr"></div>
      <p class="small muted">Вам передаётся корабль «${esc(st.ship.name)}» (${esc(st.ship.registry)}). Экипаж: ${st.ship.crew} из ${st.ship.crewMax}.</p>
    </div>
    <button class="btn btn-primary" type="button" data-act="accept">Принять командование</button>
  </div>`;
}

function eventBanner(st) {
  const ev = st.event;
  if (!ev) return "";
  if (ev.status === "pending") {
    const left = eventRemainingMs();
    const ratio = ev.timerSec ? left / (ev.timerSec * 1000) : 0;
    const urgent = left < 30000;
    return `<div class="panel alert-card pending" data-act="go" data-screen="event" role="button">
      <div class="kicker">Требуется решение капитана</div>
      <h2>${esc(ev.title)}</h2>
      <div class="timer ${urgent ? "urgent" : ""}" data-timer>${formatTimer(left)}</div>
      <div class="timer-bar"><i data-timer-bar style="width:${clampPct(ratio * 100)}%"></i></div>
      <p class="small muted" style="margin-top:8px">Нажмите, чтобы открыть событие</p>
    </div>`;
  }
  if (ev.status === "resolved" && ev.resolution) {
    return `<div class="panel" data-act="go" data-screen="event" role="button">
      <div class="kicker">Событие разрешено</div>
      <h2>${esc(ev.title)}</h2>
      <span class="badge ${esc(ev.resolution.result)}">${outcomeLabel(ev.resolution.result)}</span>
      <p class="small muted" style="margin-top:8px">Открыть итог</p>
    </div>`;
  }
  return "";
}

export function renderBridge(st) {
  const s = st.ship;
  const evPending = st.event?.status === "pending";
  const missionLine = st.mission.briefing;
  return `<div class="screen bridge">
    ${header("Пульт", { back: false, alert: evPending })}
    <div class="scr-body">
      ${st.gameOver ? renderEnding(st) : ""}
      ${eventBanner(st)}
      <div class="panel">
        <div class="kicker">Текущий приказ</div>
        <h2>${esc(st.mission.title)}</h2>
        <p class="small">${esc(missionLine)}</p>
      </div>
      <div class="panel">
        <div class="kicker">Сводка корабля</div>
        ${resBar("Экипаж", (s.crew / s.crewMax) * 100, `${s.crew}/${s.crewMax}`)}
        ${resBar("Топливо", s.fuel)}
        ${resBar("Корпус", s.hull)}
        ${resBar("Запасы", s.supplies)}
      </div>
      ${!st.gameOver && !evPending ? `<button class="btn btn-primary" type="button" data-act="continue" id="btn-continue">Продолжить полёт</button>` : ""}
      <div class="nav-grid" style="margin-top:12px">
        <button class="nav-btn" type="button" data-act="go" data-screen="event">
          <span class="ico">⚠</span><span class="nm">Событие</span>
          <span class="sub">${evPending ? "ожидает решения" : st.event ? "есть итог" : "нет активных"}</span>
        </button>
        <button class="nav-btn" type="button" data-act="go" data-screen="mission">
          <span class="ico">◆</span><span class="nm">Миссия</span>
          <span class="sub">${st.mission.goals.filter((g) => g.done).length}/${st.mission.goals.length} целей</span>
        </button>
        <button class="nav-btn" type="button" data-act="go" data-screen="log">
          <span class="ico">☰</span><span class="nm">Журнал</span>
          <span class="sub">${st.log.length} записей</span>
        </button>
        <button class="nav-btn" type="button" data-act="go" data-screen="officers">
          <span class="ico">★</span><span class="nm">Офицеры</span>
          <span class="sub">6 старших</span>
        </button>
        <button class="nav-btn" type="button" data-act="go" data-screen="ship">
          <span class="ico">▲</span><span class="nm">Корабль</span>
          <span class="sub">${esc(s.registry)}</span>
        </button>
        <button class="nav-btn" type="button" data-act="go" data-screen="settings">
          <span class="ico">⚙</span><span class="nm">Настройки</span>
          <span class="sub">${aiConfigured(getSettings()) ? "ИИ подключен" : "офлайн-режим"}</span>
        </button>
      </div>
    </div>
  </div>`;
}

function renderEnding(st) {
  const g = st.gameOver;
  return `<div class="panel ${g.victory ? "" : "alert-card"}">
    <div class="kicker">${g.victory ? "Кампания завершена" : "Критический исход"}</div>
    <h2>${esc(g.title)}</h2>
    <p>${esc(g.text)}</p>
    <div class="btn-row">
      <button class="btn" type="button" data-act="reset">Начать заново</button>
    </div>
  </div>`;
}

function checkHint(o, ev) {
  const off = o.officerId ? getOfficer(o.officerId) : null;
  const skill = SKILL_LABELS[o.skill] || o.skill;
  const dc = ev.difficulty + (o.dcMod || 0);
  const bonus = (off ? off.stats[o.skill] || 0 : 0) + systemMod(getState().ship, o.skill);
  let need = Math.min(20, Math.max(2, dc - bonus));
  const pct = Math.round(((21 - need) / 20) * 100);
  const b = (bonus >= 0 ? "+" : "−") + Math.abs(bonus);
  return `${skill} · d20 ${b}${off ? " (" + off.name + ")" : ""} против Сл. ${dc} · шанс ≈ ${pct}%`;
}

function diceBlock(roll) {
  if (!roll) return "";
  const off = roll.officerId ? getOfficer(roll.officerId) : null;
  const sgn = (n) => (n >= 0 ? "+" : "−") + Math.abs(n);
  const parts = [`бросок d20: ${roll.d20}`];
  if (off) parts.push(`${off.name}: ${sgn(roll.offMod)}`);
  if (roll.sys) parts.push(`повреждение систем: ${sgn(roll.sys)}`);
  return `<div class="dice">
    <div class="kicker">Проверка · ${esc(SKILL_LABELS[roll.skill] || roll.skill)}</div>
    <div class="roll">${roll.total} против Сл. ${roll.dc}</div>
    <p class="small muted">${esc(parts.join(" · "))} = ${roll.total}. Нужно набрать ${roll.dc} или больше.</p>
    <div><span class="badge ${esc(roll.result)}">${outcomeLabel(roll.result)}${roll.d20 === 20 ? " · natural 20" : roll.d20 === 1 ? " · natural 1" : ""}</span></div>
  </div>`;
}

function deltasList(deltas) {
  if (!deltas?.length) return `<p class="small muted">Ресурсы не изменились.</p>`;
  return `<ul class="changes">${deltas
    .map((d) => {
      const cls = d.delta > 0 ? "delta-pos" : "delta-neg";
      const sign = d.delta > 0 ? "+" : "";
      return `<li><span class="${cls}">${sign}${d.delta}${esc(d.unit || "")}</span> ${esc(d.label)}</li>`;
    })
    .join("")}</ul>`;
}

export function renderEvent(st) {
  const ev = st.event;
  if (!ev) {
    return `<div class="screen">
      ${header("Событие")}
      <div class="scr-body">
        <div class="panel">
          <div class="kicker">Обстановка</div>
          <h2>Курс спокоен</h2>
          <p>Активных событий нет. Корабль идёт прежним курсом. Когда будете готовы, продолжите полёт с пульта — датчики обязательно что-нибудь найдут.</p>
        </div>
        ${st.phase === "play" && !st.gameOver ? `<button class="btn btn-primary" type="button" data-act="continue">Продолжить полёт</button>` : ""}
      </div>
    </div>`;
  }

  if (ev.status === "resolved" && ev.resolution) {
    const r = ev.resolution;
    const by = r.source === "xo" ? "Решение принял старпом" : "Решение капитана";
    return `<div class="screen">
      ${header("Итог события")}
      <div class="scr-body">
        <div class="panel">
          <div class="kicker">${esc(by)}</div>
          <h2>${esc(ev.title)}</h2>
          <p class="small muted">${esc(r.freeText ? "Свой вариант: " + r.freeText : r.optionText)}</p>
        </div>
        ${diceBlock(r.roll)}
        <div class="panel">
          <p>${esc(r.narration)}</p>
          <div class="hr"></div>
          ${deltasList(r.deltas)}
        </div>
        <button class="btn btn-primary" type="button" data-act="dismiss">Вернуться на пульт</button>
      </div>
    </div>`;
  }

  const left = eventRemainingMs();
  const ratio = ev.timerSec ? left / (ev.timerSec * 1000) : 0;
  const urgent = left < 30000;
  const advice = ev.advice || [];
  return `<div class="screen">
    ${header("Событие")}
    <div class="scr-body">
      <div class="panel alert-card pending">
        <div class="kicker">Таймер решения</div>
        <div class="timer ${urgent ? "urgent" : ""}" data-timer>${formatTimer(left)}</div>
        <div class="timer-bar"><i data-timer-bar style="width:${clampPct(ratio * 100)}%"></i></div>
        <p class="small muted" style="margin-top:8px">Если не успеете, решение примет старпом. Оно может быть не лучшим.</p>
      </div>
      <div class="panel">
        <div class="kicker">${ev.source === "ai" ? "Событие · мастер ИИ" : "Событие"}</div>
        <h2>${esc(ev.title)}</h2>
        <p>${esc(ev.description)}</p>
      </div>
      <div class="kicker" style="margin: 4px 2px 8px">Советы офицеров</div>
      ${advice
        .map((a, i) => {
          const o = getOfficer(a.officerId);
          const name = o ? `${o.rank} ${o.name}` : a.officerId;
          const cls = i > 0 ? "conflict" : "";
          return `<div class="advice ${cls}"><div class="who">${esc(name)}</div><div>${esc(a.text)}</div></div>`;
        })
        .join("")}
      <div class="kicker" style="margin: 14px 2px 4px">Варианты</div>
      ${(ev.options || [])
        .map((o) => {
          const off = o.officerId ? getOfficer(o.officerId) : null;
          const skill = SKILL_LABELS[o.skill] || o.skill;
          const who = off ? ` · ${off.name}` : "";
          return `<button class="option" type="button" data-act="choose" data-id="${esc(o.id)}">
            <div class="ot">${esc(o.text)}</div>
            <div class="meta">${esc(checkHint(o, ev))}</div>
          </button>`;
        })
        .join("")}
      <div class="panel" style="margin-top:14px">
        <div class="kicker">Свой вариант</div>
        <p class="small muted" style="margin-bottom:8px">Напишите приказ своими словами. Игра впишет его в мир и всё равно бросит кубик.</p>
        <textarea id="free-text" placeholder="Например: обойти источник сигнала и снять только пассивные показания"></textarea>
        <button class="btn btn-amber" type="button" data-act="freetext" style="margin-top:8px">Отдать свой приказ</button>
      </div>
    </div>
  </div>`;
}

export function renderMission(st) {
  const m = st.mission;
  return `<div class="screen">
    ${header("Миссия")}
    <div class="scr-body">
      <div class="panel">
        <div class="kicker">${esc(m.issuedBy)}</div>
        <h2>${esc(m.title)}</h2>
        <p>${esc(m.briefing)}</p>
      </div>
      <div class="panel">
        <div class="kicker">Цели</div>
        ${m.goals
          .map((g) => {
            const pct = Math.round((g.progress / g.required) * 100);
            return `<div class="goal ${g.done ? "done" : ""}">
              <div class="check">${g.done ? "✓" : ""}</div>
              <div style="flex:1">
                <p>${esc(g.text)}</p>
                <div class="bar ${g.done ? "" : barClass(pct)}" style="margin-top:6px"><i style="width:${clampPct(pct)}%"></i></div>
                <div class="small faint" style="margin-top:4px">${g.done ? "выполнено" : `прогресс ${g.progress} из ${g.required}`}</div>
              </div>
            </div>`;
          })
          .join("")}
      </div>
      <div class="panel">
        <div class="kicker">Побочные задачи</div>
        ${
          m.sideQuests.length
            ? m.sideQuests
                .map(
                  (q) => `<div class="goal ${q.done ? "done" : ""}">
              <div class="check">${q.done ? "✓" : ""}</div>
              <p>${esc(q.title)}</p>
            </div>`
                )
                .join("")
            : `<p class="small muted">Пока нет. Они появляются из случайных событий.</p>`
        }
      </div>
    </div>
  </div>`;
}

export function renderLog(st) {
  return `<div class="screen">
    ${header("Судовой журнал")}
    <div class="scr-body">
      <div class="panel">
        <div class="kicker">Заметка капитана</div>
        <textarea id="captain-note" placeholder="Короткая запись от себя…"></textarea>
        <button class="btn" type="button" data-act="note" style="margin-top:8px">Добавить в журнал</button>
      </div>
      <div class="panel">
        <div class="kicker">Записи</div>
        ${
          st.log.length
            ? st.log
                .map(
                  (l) => `<article class="log-item ${esc(l.kind)}">
              <div class="log-meta">ЗС ${esc(formatStardate(l.stardate))} · ${esc(l.author)}</div>
              <p>${esc(l.text)}</p>
            </article>`
                )
                .join("")
            : `<p class="small muted">Журнал пуст.</p>`
        }
      </div>
    </div>
  </div>`;
}

export function renderOfficers(st) {
  return `<div class="screen">
    ${header("Офицеры")}
    <div class="scr-body">
      ${OFFICERS.map((o) => {
        const rel = st.relations[o.id] || 0;
        return `<button class="off-card" type="button" data-act="officer" data-id="${o.id}">
          <div class="avatar ${esc(o.dept === "command" ? "xo" : o.dept)}">${esc(initials(o.name))}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:650">${esc(o.rank)} ${esc(o.name)}</div>
            <div class="small muted">${esc(o.role)} · ${esc(DEPARTMENTS[o.dept] || o.dept)}</div>
            <div class="small faint">${esc(o.traits.join(" · "))} · ${esc(relationWord(rel))}</div>
          </div>
        </button>`;
      }).join("")}
    </div>
  </div>`;
}

export function renderOfficer(st, officerId) {
  const o = getOfficer(officerId);
  if (!o) return renderOfficers(st);
  const rel = st.relations[o.id] || 0;
  const chat = st.chats[o.id] || [];
  const stats = Object.entries(o.stats)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<div class="stat"><span>${esc(SKILL_LABELS[k])}</span><b>${v >= 0 ? "+" : ""}${v}</b></div>`)
    .join("");
  return `<div class="screen">
    ${header(o.name, { back: true })}
    <div class="scr-body">
      <div class="panel">
        <div style="display:flex;gap:12px;align-items:center;margin-bottom:8px">
          <div class="avatar ${esc(o.dept === "command" ? "xo" : o.dept)}" style="width:56px;height:56px">${esc(initials(o.name))}</div>
          <div>
            <div class="kicker" style="margin:0">${esc(o.rank)}</div>
            <h2 style="margin:0">${esc(o.name)}</h2>
            <div class="small muted">${esc(o.role)} · ${esc(DEPARTMENTS[o.dept])}</div>
          </div>
        </div>
        <div class="tags">${o.traits.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}
          <span class="tag">${esc(relationWord(rel))}</span>
        </div>
        <p class="small">${esc(o.bio)}</p>
        <div class="hr"></div>
        <div class="kicker">Навыки</div>
        <div class="stat-grid">${stats}</div>
      </div>
      <div class="panel">
        <div class="kicker">Разговор</div>
        <div class="chat" id="chat-log">
          ${
            chat.length
              ? chat
                  .map((m) => `<div class="bubble ${m.role === "me" ? "me" : "them"}">${esc(m.text)}</div>`)
                  .join("")
              : `<div class="bubble them">${esc(o.greeting)}</div>`
          }
        </div>
        <form class="chat-form" data-act="chatform" data-id="${o.id}">
          <input type="text" id="chat-input" maxlength="400" placeholder="Написать ${esc(o.name.split(" ")[0])}…" autocomplete="off">
          <button class="btn btn-primary" type="submit">Отпр.</button>
        </form>
      </div>
    </div>
  </div>`;
}

const SHIP_GLYPH = `        /\\
       /  \\
      /====\\
  ___/  ||  \\___
 /    «СТРАННИК»  \\
/______  ||  ______\\
       \\_||_/
         ^^`;

export function renderShip(st) {
  const s = st.ship;
  return `<div class="screen">
    ${header("Корабль")}
    <div class="scr-body">
      <div class="panel">
        <div class="kicker">Бортовой паспорт</div>
        <h2>«${esc(s.name)}»</h2>
        <p class="small muted">Регистр ${esc(s.registry)} · исследовательский</p>
        <div class="ship-glyph">${SHIP_GLYPH}</div>
        ${resBar("Экипаж", (s.crew / s.crewMax) * 100, `${s.crew}/${s.crewMax}`)}
        ${resBar("Топливо", s.fuel)}
        ${resBar("Корпус", s.hull)}
        ${resBar("Запасы", s.supplies)}
      </div>
      <div class="panel">
        <div class="kicker">Системы</div>
        ${SYS.map(([k, name]) => {
          const v = s.systems[k];
          const stw = statusWord(v);
          return `<div class="sys-row">
            <div style="flex:1">
              <div>${esc(name)}</div>
              <div class="bar ${barClass(v)}" style="margin-top:6px"><i style="width:${clampPct(v)}%"></i></div>
            </div>
            <div style="text-align:right;min-width:6.5em">
              <div class="pill ${stw.key}">${esc(stw.text)}</div>
              <div class="small faint" style="margin-top:4px">${v}%</div>
            </div>
          </div>`;
        }).join("")}
      </div>
    </div>
  </div>`;
}

export function renderSettings(st) {
  const s = getSettings();
  const ai = aiConfigured(s);
  return `<div class="screen">
    ${header("Настройки")}
    <div class="scr-body">
      <div class="panel">
        <div class="kicker">Таймер решения</div>
        <p class="help">В готовой игре это будут часы. Для проверки прототипа удобны минуты.</p>
        <label class="fld"><span>Секунд на решение</span>
          <input type="number" id="set-timer" min="5" max="10800" step="1" value="${esc(s.timerSec)}">
        </label>
        <div class="btn-row">
          <button class="btn" type="button" data-act="timer-preset" data-sec="30">30 с</button>
          <button class="btn" type="button" data-act="timer-preset" data-sec="180">3 мин</button>
          <button class="btn" type="button" data-act="timer-preset" data-sec="600">10 мин</button>
        </div>
      </div>
      <div class="panel">
        <div class="kicker">ИИ-мастер</div>
        <p class="help">Любой OpenAI-совместимый адрес: официальный API, Open WebUI или Ollama. Без ключа игра работает офлайн — на встроенных событиях.</p>
        <p class="small ${ai ? "green" : "muted"}" style="margin-bottom:8px">${ai ? "Ключ и адрес заданы. Новые события пойдут через модель, при сбое — офлайн-набор." : "Сейчас офлайн-режим."}</p>
        <label class="fld"><span>Базовый URL</span>
          <input type="url" id="set-url" placeholder="https://api.openai.com/v1 или http://дом:11434/v1" value="${esc(s.apiBaseUrl)}">
        </label>
        <label class="fld"><span>Ключ API</span>
          <input type="password" id="set-key" placeholder="sk-…" value="${esc(s.apiKey)}" autocomplete="off">
        </label>
        <label class="fld"><span>Модель</span>
          <input type="text" id="set-model" placeholder="gpt-4o-mini, llama3.1…" value="${esc(s.model)}">
        </label>
        <div class="btn-row">
          <button class="btn btn-primary" type="button" data-act="save-ai">Сохранить</button>
          <button class="btn" type="button" data-act="test-ai">Проверить связь</button>
        </div>
        <div id="ai-msg"></div>
      </div>
      <div class="panel">
        <div class="kicker">Уведомления</div>
        <p class="help">Пока приложение открыто, браузер может показать системное уведомление о новом событии. Настоящий фоновый пуш потребует сервер — это следующий этап.</p>
        <button class="btn" type="button" data-act="notify">${s.notify ? "Уведомления разрешены" : "Разрешить уведомления"}</button>
      </div>
      <div class="panel">
        <div class="kicker">Кампания</div>
        <p class="help">Состояние пишется на это устройство автоматически. Сброс начнёт новую кампанию; ключ API сохранится.</p>
        <button class="btn btn-danger" type="button" data-act="reset">Сбросить кампанию</button>
      </div>
      <p class="small faint center" style="margin-top:16px">Капитан на удалёнке · прототип 0.1</p>
    </div>
  </div>`;
}

export function renderScreen(name, params) {
  const st = getState();
  if (!st || st.phase === "briefing") return renderBriefing(st || { mission: {}, ship: {} });
  switch (name) {
    case "event": return renderEvent(st);
    case "mission": return renderMission(st);
    case "log": return renderLog(st);
    case "officers": return renderOfficers(st);
    case "officer": return renderOfficer(st, params.id);
    case "ship": return renderShip(st);
    case "settings": return renderSettings(st);
    default: return renderBridge(st);
  }
}

export function updateTimersInPlace() {
  const ev = getState()?.event;
  if (!ev || ev.status !== "pending") return false;
  const left = eventRemainingMs();
  const ratio = ev.timerSec ? left / (ev.timerSec * 1000) : 0;
  const urgent = left < 30000;
  for (const el of document.querySelectorAll("[data-timer]")) {
    el.textContent = formatTimer(left);
    el.classList.toggle("urgent", urgent);
  }
  for (const el of document.querySelectorAll("[data-timer-bar]")) {
    el.style.width = clampPct(ratio * 100) + "%";
  }
  return true;
}
