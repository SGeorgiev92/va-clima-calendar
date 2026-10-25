"use strict";

const db = window.supabase.createClient(window.CALENDAR.url, window.CALENDAR.anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

const MONTHS = [
  "януари", "февруари", "март", "април", "май", "юни",
  "юли", "август", "септември", "октомври", "ноември", "декември",
];
const WEEKDAYS = ["неделя", "понеделник", "вторник", "сряда", "четвъртък", "петък", "събота"];

const COLORS = [
  { id: "blue", name: "Синьо", light: "#007AFF", dark: "#0A84FF" },
  { id: "red", name: "Червено", light: "#FF3B30", dark: "#FF453A" },
  { id: "orange", name: "Оранжево", light: "#FF9500", dark: "#FF9F0A" },
  { id: "green", name: "Зелено", light: "#34C759", dark: "#30D158" },
  { id: "teal", name: "Синьозелено", light: "#32ADE6", dark: "#64D2FF" },
  { id: "indigo", name: "Индиго", light: "#5856D6", dark: "#5E5CE6" },
  { id: "purple", name: "Лилаво", light: "#AF52DE", dark: "#BF5AF2" },
  { id: "pink", name: "Розово", light: "#FF2D55", dark: "#FF375F" },
];

const state = {
  visibleMonth: startOfMonth(new Date()),
  selectedDate: startOfDay(new Date()),
  events: [],
};

let eventsChannel = null;

let session = null;
let closeTimer = 0;
let suppressClick = false;

const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function daysInMonth(monthDate) {
  return new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
}

function capitalize(text) {
  return text.charAt(0).toLocaleUpperCase("bg-BG") + text.slice(1);
}

function formatMonth(date, withYear) {
  const name = capitalize(MONTHS[date.getMonth()]);
  if (withYear || date.getFullYear() !== new Date().getFullYear()) {
    return `${name} ${date.getFullYear()}`;
  }
  return name;
}

function formatLongDate(date) {
  return capitalize(`${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]}`);
}

function eventCountLabel(count) {
  return count === 1 ? "1 събитие" : `${count} събития`;
}

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function isDark() {
  return prefersDark.matches;
}

function colorHex(id) {
  const found = COLORS.find((color) => color.id === id) || COLORS[0];
  return isDark() ? found.dark : found.light;
}

function addMinutes(time, minutes) {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  if (total >= 24 * 60 || total < 0) return null;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function defaultTimes(date) {
  const now = new Date();
  if (!isSameDay(date, now)) return { startTime: "09:00", endTime: "10:00" };
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  if (!isSameDay(next, now)) return { startTime: "22:00", endTime: "23:00" };
  const startTime = `${String(next.getHours()).padStart(2, "0")}:00`;
  return { startTime, endTime: addMinutes(startTime, 60) || "23:59" };
}

function isEvent(event) {
  if (!event || typeof event !== "object") return false;
  if (typeof event.id !== "string" || !event.id) return false;
  if (typeof event.title !== "string") return false;
  if (typeof event.allDay !== "boolean") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event.startDate || "")) return false;
  if (!/^\d{2}:\d{2}$/.test(event.startTime || "")) return false;
  if (!/^\d{2}:\d{2}$/.test(event.endTime || "")) return false;
  return true;
}

function normalize(event) {
  return {
    id: event.id,
    title: event.title || "Ново събитие",
    location: typeof event.location === "string" ? event.location : "",
    notes: typeof event.notes === "string" ? event.notes : "",
    allDay: event.allDay,
    startDate: event.startDate,
    startTime: event.startTime,
    endTime: event.endTime,
    color: COLORS.some((color) => color.id === event.color) ? event.color : "blue",
  };
}

function fromRow(row) {
  return {
    id: row.id,
    title: row.title,
    location: row.location || "",
    notes: row.notes || "",
    allDay: Boolean(row.all_day),
    startDate: row.start_date,
    startTime: String(row.start_time || "").slice(0, 5),
    endTime: String(row.end_time || "").slice(0, 5),
    color: row.color,
  };
}

function toRow(event) {
  return {
    id: event.id,
    title: event.title,
    location: event.location,
    notes: event.notes,
    all_day: event.allDay,
    start_date: event.startDate,
    start_time: event.startTime,
    end_time: event.endTime,
    color: event.color,
  };
}

function setStatus(message) {
  const status = document.getElementById("status");
  status.hidden = !message;
  status.textContent = message || "";
}

async function refreshEvents(quiet) {
  const { data, error } = await db
    .from("events")
    .select("id,title,location,notes,all_day,start_date,start_time,end_time,color");
  if (error) {
    setStatus("Няма връзка с базата.");
    return;
  }
  setStatus("");
  state.events = data.map(fromRow).filter(isEvent).map(normalize);
  render(0, { quiet: Boolean(quiet) });
}

async function upsertEvent(event) {
  const { error } = await db.from("events").upsert(toRow(event));
  if (error) throw error;
}

async function deleteEvent(id) {
  const { error } = await db.from("events").delete().eq("id", id);
  if (error) throw error;
}

function subscribeToEvents() {
  if (eventsChannel) return;
  eventsChannel = db.channel("calendar-events")
    .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => {
      refreshEvents(true);
    })
    .subscribe();
}

function eventsOn(date) {
  const key = toDateKey(date);
  return state.events
    .filter((event) => event.startDate === key)
    .sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return a.startTime.localeCompare(b.startTime) || a.title.localeCompare(b.title, "bg");
    });
}

function buildWeeks(monthDate) {
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const weeks = [];
  for (let week = 0; week < 6; week += 1) {
    const days = [];
    for (let day = 0; day < 7; day += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + week * 7 + day);
      days.push(date);
    }
    weeks.push(days);
  }
  if (weeks[5].every((date) => date.getMonth() !== monthDate.getMonth())) weeks.pop();
  return weeks;
}

function render(monthDelta, options) {
  const quiet = Boolean(options && options.quiet);
  const today = new Date();
  document.getElementById("today-btn").hidden = isSameDay(state.selectedDate, today);
  document.getElementById("month-label").textContent = formatMonth(state.visibleMonth);
  document.title = `${formatMonth(state.visibleMonth, true)} · Календар`;
  renderGrid(quiet ? 0 : monthDelta);
  renderAgenda(quiet);
}

function renderGrid(monthDelta) {
  const grid = document.getElementById("grid");
  const month = state.visibleMonth;
  const todayKey = toDateKey(new Date());
  const selectedKey = toDateKey(state.selectedDate);
  grid.setAttribute("aria-label", formatMonth(month, true));
  grid.innerHTML = buildWeeks(month).map((week) => week.map((date) => {
    const key = toDateKey(date);
    const outside = date.getMonth() !== month.getMonth();
    const events = eventsOn(date);
    const classes = ["day"];
    if (outside) classes.push("outside");
    if (key === todayKey) classes.push("today");
    if (key === selectedKey) classes.push("selected");
    const dots = events.slice(0, 3).map((event) => (
      `<span class="dot" style="background:${colorHex(event.color)}"></span>`
    )).join("");
    const label = events.length
      ? `${formatLongDate(date)}, ${eventCountLabel(events.length)}`
      : formatLongDate(date);
    return `<button type="button" class="${classes.join(" ")}" data-date="${key}" aria-label="${esc(label)}" aria-pressed="${key === selectedKey}"${key === todayKey ? ' aria-current="date"' : ""}>
      <span class="day-num">${date.getDate()}</span>
      <span class="dots">${dots}</span>
    </button>`;
  }).join("")).join("");

  grid.classList.remove("slide-next", "slide-prev");
  if (monthDelta) {
    void grid.offsetWidth;
    grid.classList.add(monthDelta > 0 ? "slide-next" : "slide-prev");
  }
}

function renderAgenda(quiet) {
  const label = document.getElementById("agenda-label");
  const list = document.getElementById("agenda-list");
  label.textContent = formatLongDate(state.selectedDate);
  label.classList.toggle("is-today", isSameDay(state.selectedDate, new Date()));
  const events = eventsOn(state.selectedDate);
  list.innerHTML = events.length
    ? events.map((event) => {
      const ink = colorHex(event.color);
      const times = event.allDay
        ? '<div class="event-start">цял ден</div>'
        : `<div class="event-start">${esc(event.startTime)}</div><div class="event-end">${esc(event.endTime)}</div>`;
      const location = event.location
        ? `<span class="event-location">${esc(event.location)}</span>`
        : "";
      return `<button type="button" class="event${event.allDay ? " all-day" : ""}" data-id="${esc(event.id)}">
        <span class="event-times">${times}</span>
        <span class="event-body">
          <span class="event-title" style="color:${ink}">${esc(event.title)}</span>
          ${location}
        </span>
      </button>`;
    }).join("")
    : '<p class="empty">Няма събития</p>';
  if (quiet) return;
  list.classList.remove("fade");
  void list.offsetWidth;
  list.classList.add("fade");
  document.querySelector(".agenda").scrollTop = 0;
}

function selectDate(date) {
  const next = startOfDay(date);
  const nextMonth = startOfMonth(next);
  const monthDelta = (nextMonth.getFullYear() - state.visibleMonth.getFullYear()) * 12
    + (nextMonth.getMonth() - state.visibleMonth.getMonth());
  state.selectedDate = next;
  state.visibleMonth = nextMonth;
  render(monthDelta);
}

function shiftMonth(delta) {
  const nextMonth = new Date(state.visibleMonth.getFullYear(), state.visibleMonth.getMonth() + delta, 1);
  const day = Math.min(state.selectedDate.getDate(), daysInMonth(nextMonth));
  state.visibleMonth = nextMonth;
  state.selectedDate = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), day);
  render(delta);
}

function formSnapshot() {
  const selected = document.querySelector(".color-dot[aria-checked='true']");
  return {
    title: document.getElementById("event-title").value.trim(),
    location: document.getElementById("event-location").value.trim(),
    notes: document.getElementById("event-notes").value.trim(),
    allDay: document.getElementById("all-day").getAttribute("aria-checked") === "true",
    startDate: document.getElementById("event-date").value,
    startTime: document.getElementById("event-start").value,
    endTime: document.getElementById("event-end").value,
    color: selected ? selected.dataset.color : "blue",
  };
}

function setError(message) {
  const error = document.getElementById("form-error");
  error.hidden = !message;
  error.textContent = message || "";
}

function renderSheet() {
  const draft = session.draft;
  const editing = Boolean(session.originalId);
  const colors = COLORS.map((color) => {
    const hex = isDark() ? color.dark : color.light;
    const checked = color.id === draft.color;
    return `<button type="button" class="color-dot" role="radio" data-color="${color.id}" aria-label="${color.name}" aria-checked="${checked}" style="background:${hex};--ring:${hex}"></button>`;
  }).join("");
  document.getElementById("sheet").innerHTML = `
    <div class="sheet-head">
      <div class="grabber"></div>
      <div class="sheet-head-row">
        <button type="button" class="text-btn" id="sheet-cancel">Отказ</button>
        <h2 id="sheet-title">${editing ? "Редакция" : "Ново събитие"}</h2>
        <button type="button" class="text-btn strong" id="sheet-save">${editing ? "Готово" : "Добави"}</button>
      </div>
    </div>
    <div class="sheet-body">
      <div class="group">
        <input id="event-title" class="title-input" type="text" placeholder="Заглавие" maxlength="120" autocomplete="off" enterkeyhint="done" value="${esc(draft.title)}">
      </div>
      <div class="group">
        <input id="event-location" class="location-input" type="text" placeholder="Място" maxlength="200" autocomplete="off" value="${esc(draft.location)}">
      </div>
      <div class="group">
        <div class="row">
          <span class="row-label" id="all-day-label">Цял ден</span>
          <button type="button" class="switch" id="all-day" role="switch" aria-labelledby="all-day-label" aria-checked="${draft.allDay ? "true" : "false"}"><span></span></button>
        </div>
        <div class="row">
          <label class="row-label" for="event-date">Дата</label>
          <input id="event-date" type="date" value="${esc(draft.startDate)}" required>
        </div>
        <div class="row" id="start-row" ${draft.allDay ? "hidden" : ""}>
          <label class="row-label" for="event-start">Начало</label>
          <input id="event-start" type="time" step="60" value="${esc(draft.startTime)}" required>
        </div>
        <div class="row" id="end-row" ${draft.allDay ? "hidden" : ""}>
          <label class="row-label" for="event-end">Край</label>
          <input id="event-end" type="time" step="60" value="${esc(draft.endTime)}" required>
        </div>
        <p class="form-error" id="form-error" hidden></p>
      </div>
      <div class="group">
        <div class="row">
          <span class="row-label">Цвят</span>
          <div class="colors" role="radiogroup" aria-label="Цвят">${colors}</div>
        </div>
      </div>
      <div class="group">
        <textarea id="event-notes" placeholder="Бележки" maxlength="2000">${esc(draft.notes)}</textarea>
      </div>
      ${editing ? '<button type="button" class="delete-btn" id="sheet-delete">Изтрий събитие</button>' : ""}
    </div>
  `;

  document.getElementById("sheet-cancel").addEventListener("click", attemptClose);
  document.getElementById("sheet-save").addEventListener("click", saveEvent);
  document.getElementById("event-title").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveEvent();
    }
  });
  document.getElementById("all-day").addEventListener("click", () => {
    const button = document.getElementById("all-day");
    const on = button.getAttribute("aria-checked") !== "true";
    button.setAttribute("aria-checked", on ? "true" : "false");
    document.getElementById("start-row").hidden = on;
    document.getElementById("end-row").hidden = on;
    const start = document.getElementById("event-start");
    const end = document.getElementById("event-end");
    if (!on && start.value === "00:00" && end.value === "23:59") {
      const dateValue = document.getElementById("event-date").value;
      const times = defaultTimes(dateValue ? parseDate(dateValue) : state.selectedDate);
      start.value = times.startTime;
      end.value = times.endTime;
    }
    setError("");
  });
  document.getElementById("event-start").addEventListener("change", () => {
    setError("");
    const start = document.getElementById("event-start");
    const end = document.getElementById("event-end");
    if (start.value && end.value && end.value <= start.value) {
      const bumped = addMinutes(start.value, 60);
      if (bumped) end.value = bumped;
    }
  });
  document.getElementById("event-end").addEventListener("change", () => setError(""));
  document.getElementById("event-date").addEventListener("change", () => setError(""));
  document.querySelectorAll(".color-dot").forEach((dot) => {
    dot.addEventListener("click", () => {
      document.querySelectorAll(".color-dot").forEach((item) => item.setAttribute("aria-checked", "false"));
      dot.setAttribute("aria-checked", "true");
    });
  });
  const remove = document.getElementById("sheet-delete");
  if (remove) remove.addEventListener("click", confirmDelete);

  const sheet = document.getElementById("sheet");
  let swipe = null;
  sheet.ontouchstart = (event) => {
    const touch = event.touches[0];
    swipe = { x: touch.clientX, y: touch.clientY };
  };
  sheet.ontouchend = (event) => {
    if (!swipe) return;
    const end = event.changedTouches[0];
    const dy = end.clientY - swipe.y;
    const startedAtTop = swipe.y - sheet.getBoundingClientRect().top < 64;
    swipe = null;
    if (startedAtTop && dy > 72) attemptClose();
  };
}

function openEditor(existing) {
  clearTimeout(closeTimer);
  const times = defaultTimes(state.selectedDate);
  const draft = existing
    ? normalize(existing)
    : {
      id: uid(),
      title: "",
      location: "",
      notes: "",
      allDay: false,
      startDate: toDateKey(state.selectedDate),
      startTime: times.startTime,
      endTime: times.endTime,
      color: "blue",
    };
  session = {
    originalId: existing ? existing.id : null,
    draft,
    initial: JSON.stringify({
      title: draft.title,
      location: draft.location,
      notes: draft.notes,
      allDay: draft.allDay,
      startDate: draft.startDate,
      startTime: draft.startTime,
      endTime: draft.endTime,
      color: draft.color,
    }),
  };
  renderSheet();
  const overlay = document.getElementById("overlay");
  overlay.hidden = false;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => overlay.classList.add("show"));
  });
  if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    setTimeout(() => document.getElementById("event-title").focus(), 60);
  }
}

function isDirty() {
  if (!session || !document.getElementById("event-title")) return false;
  return JSON.stringify(formSnapshot()) !== session.initial;
}

function attemptClose() {
  if (isDirty()) {
    showConfirm({
      title: "Отхвърляне на промените?",
      confirmLabel: "Отхвърли",
      cancelLabel: "Продължи",
      onConfirm: finishClose,
    });
    return;
  }
  finishClose();
}

function finishClose() {
  const overlay = document.getElementById("overlay");
  overlay.classList.remove("show");
  const confirmLayer = document.getElementById("confirm");
  confirmLayer.hidden = true;
  confirmLayer.innerHTML = "";
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    overlay.hidden = true;
    document.getElementById("sheet").innerHTML = "";
    session = null;
  }, prefersReducedMotion.matches ? 0 : 320);
}

async function saveEvent() {
  const data = formSnapshot();
  if (!data.startDate) {
    setError("Избери дата.");
    return;
  }
  if (!data.allDay && (!data.startTime || !data.endTime || data.endTime <= data.startTime)) {
    setError("Краят трябва да е след началото.");
    return;
  }
  const event = normalize({
    id: session.draft.id,
    title: data.title,
    location: data.location,
    notes: data.notes,
    allDay: data.allDay,
    startDate: data.startDate,
    startTime: data.allDay ? "00:00" : data.startTime,
    endTime: data.allDay ? "23:59" : data.endTime,
    color: data.color,
  });
  const button = document.getElementById("sheet-save");
  button.disabled = true;
  try {
    await upsertEvent(event);
  } catch (error) {
    setError("Не успя да се запише. Провери връзката.");
    button.disabled = false;
    return;
  }
  const index = state.events.findIndex((item) => item.id === event.id);
  if (index >= 0) state.events[index] = event;
  else state.events.push(event);
  finishClose();
  selectDate(parseDate(event.startDate));
}

function confirmDelete() {
  showConfirm({
    title: "Изтриване на събитието?",
    confirmLabel: "Изтрий",
    cancelLabel: "Отказ",
    onConfirm: async () => {
      const id = session.draft.id;
      try {
        await deleteEvent(id);
      } catch (error) {
        setStatus("Не успя да се изтрие. Провери връзката.");
        return;
      }
      state.events = state.events.filter((event) => event.id !== id);
      finishClose();
      render(0);
    },
  });
}

function showConfirm({ title, confirmLabel, cancelLabel, onConfirm }) {
  const layer = document.getElementById("confirm");
  layer.innerHTML = `
    <div class="confirm-stack">
      <div class="confirm-box">
        <p class="confirm-title">${esc(title)}</p>
        <button type="button" class="confirm-danger" id="confirm-ok">${esc(confirmLabel)}</button>
      </div>
      <button type="button" class="confirm-cancel" id="confirm-cancel">${esc(cancelLabel)}</button>
    </div>
  `;
  layer.hidden = false;
  layer.onclick = (event) => {
    if (event.target === layer) layer.hidden = true;
  };
  document.getElementById("confirm-cancel").onclick = () => {
    layer.hidden = true;
  };
  document.getElementById("confirm-ok").onclick = () => {
    layer.hidden = true;
    onConfirm();
  };
}

function onGridClick(event) {
  if (suppressClick) return;
  const button = event.target.closest("[data-date]");
  if (!button) return;
  selectDate(parseDate(button.dataset.date));
}

function onAgendaClick(event) {
  const button = event.target.closest("[data-id]");
  if (!button) return;
  const found = state.events.find((item) => item.id === button.dataset.id);
  if (found) openEditor(found);
}

function onKeyDown(event) {
  const confirmLayer = document.getElementById("confirm");
  const overlay = document.getElementById("overlay");
  if (event.key === "Escape") {
    if (!confirmLayer.hidden) {
      confirmLayer.hidden = true;
      return;
    }
    if (!overlay.hidden) attemptClose();
    return;
  }
  if (!overlay.hidden || !confirmLayer.hidden || !document.getElementById("gate").hidden) return;
  if (event.target.closest("input, textarea")) return;
  const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
  if (!delta) return;
  event.preventDefault();
  const next = new Date(state.selectedDate);
  next.setDate(next.getDate() + delta);
  selectDate(next);
}

function setupSwipe() {
  const grid = document.getElementById("grid");
  let start = null;
  grid.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse") return;
    if (!document.getElementById("overlay").hidden) return;
    start = { x: event.clientX, y: event.clientY, id: event.pointerId };
  });
  grid.addEventListener("pointerup", (event) => {
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    start = null;
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    suppressClick = true;
    setTimeout(() => {
      suppressClick = false;
    }, 400);
    shiftMonth(dx < 0 ? 1 : -1);
  });
  grid.addEventListener("pointercancel", () => {
    start = null;
  });
}

function setLocked(locked) {
  document.getElementById("gate").hidden = !locked;
  document.querySelector(".header").toggleAttribute("inert", locked);
  document.getElementById("grid").toggleAttribute("inert", locked);
  document.querySelector(".agenda").toggleAttribute("inert", locked);
}

async function onGateSubmit(event) {
  event.preventDefault();
  const input = document.getElementById("gate-password");
  const error = document.getElementById("gate-error");
  const button = document.getElementById("gate-submit");
  error.hidden = true;
  button.disabled = true;
  const { error: authError } = await db.auth.signInWithPassword({
    email: window.CALENDAR.email,
    password: input.value,
  });
  button.disabled = false;
  if (authError) {
    error.hidden = false;
    error.textContent = "Грешна парола.";
    input.select();
  }
}

function init() {
  document.getElementById("prev-btn").addEventListener("click", () => shiftMonth(-1));
  document.getElementById("next-btn").addEventListener("click", () => shiftMonth(1));
  document.getElementById("today-btn").addEventListener("click", () => selectDate(new Date()));
  document.getElementById("add-btn").addEventListener("click", () => openEditor(null));
  document.getElementById("grid").addEventListener("click", onGridClick);
  document.getElementById("agenda-list").addEventListener("click", onAgendaClick);
  document.getElementById("overlay").addEventListener("click", attemptClose);
  document.getElementById("sheet").addEventListener("click", (event) => event.stopPropagation());
  document.getElementById("gate").addEventListener("submit", onGateSubmit);
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && document.getElementById("gate").hidden) {
      refreshEvents(true);
    }
  });
  prefersDark.addEventListener("change", () => render(0, { quiet: true }));
  setupSwipe();
  render(0);
  setLocked(true);
  db.auth.onAuthStateChange((event, authSession) => {
    if (!authSession) {
      setLocked(true);
      return;
    }
    setLocked(false);
    subscribeToEvents();
    refreshEvents(event === "INITIAL_SESSION");
  });
}

init();
