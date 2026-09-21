
/*
  Plato · Turnos en casa — versión Supabase completa
  ---------------------------------------------------------
  Pegá tus dos valores:
*/
const SUPABASE_URL = "https://npahpizludttsqjgbtsn.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_0fDqhgUIx9aR1T3qGF4ZOA_vyyYbMA9";

const client = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

const FAMILY = ["Mamá", "Mariano", "Santi", "Papá"];

const MEMBER_META = {
  "Mamá": { short: "Ma", slug: "mama", colorClass: "dot-mama" },
  "Papá": { short: "Pa", slug: "papa", colorClass: "dot-papa" },
  "Mariano": { short: "Ma", slug: "mariano", colorClass: "dot-mariano" },
  "Santi": { short: "Sa", slug: "santi", colorClass: "dot-santi" }
};

let currentMember = null;
let currentUser = null;
let ticketAdmin = false;
let ticketAdminSaving = false;
let pastTurnSaving = false;
let daySuspensionSaving = false;
let familyMembers = [];
let memberById = {};
let turns = [];
let todayTurn = null;
let currentCalendarDate = new Date();

const el = (id) => document.getElementById(id);

function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatLongDate(date) {
  return new Intl.DateTimeFormat("es-AR", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(date);
}

function formatMonth(date) {
  const text = new Intl.DateTimeFormat("es-AR", {
    month: "long",
    year: "numeric"
  }).format(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function memberName(id) {
  return memberById[id]?.name || "—";
}

function setView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active-view"));
  document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));

  el(`view-${name}`)?.classList.add("active-view");
  document.querySelector(`.nav-item[data-view="${name}"]`)?.classList.add("active");

  const labels = {
    today: "Hoy",
    calendar: "Calendario",
    history: "Historial",
    agreements: "Acuerdos"
  };
  el("breadcrumb-current").textContent = labels[name] || "Hoy";
}

function showLogin(message = "") {
  ticketAdmin = false;
  el("ticket-admin").classList.add("hidden");
  el("app").classList.add("hidden");
  el("login-screen").classList.remove("hidden");
  el("login-error").textContent = message;
}

function showApp() {
  el("login-screen").classList.add("hidden");
  el("app").classList.remove("hidden");
}

async function loginWithGoogle() {
  el("login-error").textContent = "";

  const { error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin
    }
  });

  if (error) el("login-error").textContent = error.message;
}

async function logout() {
  await client.auth.signOut();
  location.reload();
}

async function getCurrentUser() {
  const { data, error } = await client.auth.getUser();
  if (error) return null;
  return data.user;
}

async function loadCurrentMember(user) {
  if (!user?.email) return null;

  const { data, error } = await client
    .from("family_members")
    .select("*")
    .or(`auth_user_id.eq.${user.id},email.ilike.${user.email}`)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  if (!data.auth_user_id) {
    const { error: updateError } = await client
      .from("family_members")
      .update({ auth_user_id: user.id })
      .eq("id", data.id)
      .is("auth_user_id", null);

    if (!updateError) data.auth_user_id = user.id;
  }

  return data;
}

async function loadFamilyMembers() {
  const { data, error } = await client
    .from("family_members")
    .select("id,name,email,tickets,auth_user_id");

  if (error) throw error;

  familyMembers = data || [];
  memberById = Object.fromEntries(familyMembers.map(m => [m.id, m]));
  currentMember = familyMembers.find(m => m.id === currentMember.id) || currentMember;
}

async function loadTurns() {
  const end = new Date();
  end.setMonth(end.getMonth() + 14);
  // Include older pending turns too; paginate instead of silently truncating them.
  const loaded = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client.from("turns").select("*")
      .lte("date", localDateKey(end)).order("date", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    loaded.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  turns = loaded;
  todayTurn = turns.find(t => t.date === localDateKey()) || null;
}

async function refreshData() {
  await loadFamilyMembers();
  await loadTurns();
  renderIdentity();
  renderTickets();
  renderTicketAdmin();
  renderToday();
  renderCalendar(currentCalendarDate);
  renderOffers();
  await renderHistory();
}

function renderIdentity() {
  el("top-user-name").textContent =
    `${currentMember.name} · ${currentMember.tickets ?? 0} tickets`;
}

function renderTickets() {
  let total = 0;

  for (const name of FAMILY) {
    const member = familyMembers.find(m => m.name === name);
    const count = Number(member?.tickets ?? 0);
    total += count;
    const node = el(`tickets-${MEMBER_META[name].slug}`);
    if (node) node.textContent = count;
  }

  el("tickets-total").textContent = total;
}

// Fail closed: only the protected server RPC can enable this control.
async function loadTicketAdmin() {
  ticketAdmin = false;
  try {
    const { data, error } = await client.rpc("is_ticket_admin");
    ticketAdmin = !error && data === true;
  } catch (_) {
    ticketAdmin = false;
  }
  renderTicketAdmin();
  renderCalendar(currentCalendarDate);
  renderToday();
}

function renderTicketAdmin() {
  el("ticket-admin").classList.toggle("hidden", !ticketAdmin);
  if (!ticketAdmin) return;
  const select = el("ticket-admin-member");
  const previous = select.value;
  select.replaceChildren();
  for (const member of familyMembers) {
    const option = document.createElement("option");
    option.value = String(member.id);
    option.textContent = `${member.name} · ${member.tickets ?? 0} tickets`;
    select.appendChild(option);
  }
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
  syncTicketAdminBalance();
}

function syncTicketAdminBalance() {
  const member = familyMembers.find(m => String(m.id) === el("ticket-admin-member").value);
  el("ticket-admin-balance").value = member ? member.tickets ?? 0 : "";
}

async function saveTicketBalance(event) {
  event.preventDefault();
  if (!ticketAdmin || ticketAdminSaving) return;
  const message = el("ticket-admin-message");
  const member = familyMembers.find(m => String(m.id) === el("ticket-admin-member").value);
  const raw = el("ticket-admin-balance").value.trim();
  const balance = Number(raw);
  if (!member || !/^\d+$/.test(raw) || !Number.isSafeInteger(balance) || balance > 2147483647) {
    message.textContent = "Ingresá una cantidad entera entre 0 y 2147483647.";
    return;
  }
  if (balance === Number(member.tickets)) {
    message.textContent = "El saldo ya tiene esa cantidad.";
    return;
  }
  if (!confirm(`¿Fijar el saldo de ${member.name} en ${balance} tickets? Ahora tiene ${member.tickets}.`)) return;
  ticketAdminSaving = true;
  el("ticket-admin-fields").disabled = true;
  message.textContent = "Guardando…";
  let saved = false;
  try {
    const { error } = await client.rpc("admin_set_ticket_balance", {
      p_member_id: member.id,
      p_balance: balance,
      p_expected_balance: Number(member.tickets)
    });
    if (error) throw error;
    saved = true;
    await refreshData();
    message.textContent = `Saldo de ${member.name} actualizado a ${balance} tickets.`;
  } catch (error) {
    message.textContent = saved
      ? "El saldo se guardó, pero no se pudo actualizar la pantalla. Recargá la página."
      : error?.code === "P0001"
        ? "El saldo cambió mientras editabas. Recargá la página y volvé a intentarlo."
        : "No se pudo guardar. Recargá para comprobar el saldo y los permisos antes de volver a intentar.";
    if (error?.code === "42501") await loadTicketAdmin();
  } finally {
    ticketAdminSaving = false;
    el("ticket-admin-fields").disabled = false;
  }
}

function humanStatus(status) {
  return {
    pending: "Pendiente",
    offered: "Publicado",
    covered: "Cubierto",
    completed: "Completado",
    absent: "Ausencia",
    suspended: "Suspendido"
  }[status] || status;
}

function effectiveTurnMember(turn) {
  if (!turn) return null;
  if (turn.covered_by_member_id && turn.status === "covered") {
    return memberName(turn.covered_by_member_id);
  }
  return memberName(turn.assigned_member_id);
}

function renderToday() {
  const today = new Date();
  el("today-date").textContent = formatLongDate(today);
  const dayButton = el("suspend-day-btn");
  dayButton.classList.toggle("hidden", !canSuspendDay(todayTurn));
  dayButton.disabled = daySuspensionSaving || pastTurnSaving;
  const suspended = todayTurn?.status === "suspended";
  el("suspend-day-icon").textContent = suspended ? "▶" : "Ⅱ";
  el("suspend-day-title").textContent = suspended ? "Reactivar día" : "Suspender día";
  el("suspend-day-description").textContent = suspended
    ? "Volver a dejar este turno pendiente."
    : "Hoy no hace falta lavar. Los demás turnos siguen igual.";

  if (!todayTurn) {
    el("today-member-name").textContent = "Sin turno.";
    el("turn-status").textContent = "Sin datos";
    el("washed-btn").disabled = true;
    el("publish-turn-btn").disabled = true;
    el("absence-btn").disabled = true;
    return;
  }

  const assignedName = memberName(todayTurn.assigned_member_id);
  const displayName = effectiveTurnMember(todayTurn);
  const meta = MEMBER_META[displayName] || { short: "—" };

  el("today-member-name").textContent = suspended ? "Hoy no se lava." : `${displayName}.`;
  el("today-member-avatar").textContent = suspended ? "Ⅱ" : meta.short;
  el("turn-status").textContent = humanStatus(todayTurn.status);
  el("turn-type-label").textContent = suspended ? "Sin lavado" : "Turno normal";
  el("turn-description").textContent = suspended
    ? "Hoy descansamos de los platos. El calendario sigue mañana."
    : "Después de cenar, la cocina queda en tus manos.";

  const isAssigned = currentMember?.id === todayTurn.assigned_member_id;
  const isCover = currentMember?.id === todayTurn.covered_by_member_id;
  const canComplete =
    todayTurn.status !== "completed" && todayTurn.status !== "suspended" &&
    ((todayTurn.covered_by_member_id && isCover) ||
      (!todayTurn.covered_by_member_id && isAssigned));

  el("washed-btn").disabled = !canComplete;
  el("publish-turn-btn").disabled = !(isAssigned && todayTurn.status === "pending");
  el("absence-btn").disabled = !(isAssigned && todayTurn.status === "pending");

  const banner = el("status-banner");

  if (suspended) {
    banner.textContent = "Día suspendido: no hace falta lavar. Los próximos turnos siguen igual.";
    banner.classList.remove("hidden");
  } else if (todayTurn.status === "offered") {
    banner.textContent =
      `${assignedName} publicó este turno por ${todayTurn.ticket_price} ticket.`;
    banner.classList.remove("hidden");
  } else if (todayTurn.status === "covered") {
    banner.textContent =
      `${memberName(todayTurn.covered_by_member_id)} aceptó cubrir el turno de ${assignedName}.`;
    banner.classList.remove("hidden");
  } else if (todayTurn.status === "absent") {
    banner.textContent =
      `Hubo una ausencia. Esta noche le toca a ${memberName(todayTurn.assigned_member_id)}.`;
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
  }

  renderWeek();
}

function renderWeek() {
  const host = el("week-strip");
  host.innerHTML = "";

  const today = new Date();

  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const key = localDateKey(d);
    const turn = turns.find(t => t.date === key);
    const name = turn ? effectiveTurnMember(turn) : "—";
    const meta = MEMBER_META[name] || { colorClass: "" };

    const box = document.createElement("div");
    box.className = "week-day";
    box.innerHTML = `
      <strong>${new Intl.DateTimeFormat("es-AR",{weekday:"short",day:"numeric"}).format(d)}</strong>
      <span><span class="member-dot ${meta.colorClass}"></span>${name}</span>
      <small>${turn ? humanStatus(turn.status) : "Sin datos"}</small>
    `;
    host.appendChild(box);
  }
}

function householdDateKey() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const get = type => parts.find(part => part.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function canCompletePastTurn(turn) {
  return ticketAdmin && turn && turn.status === "pending"
    && !turn.covered_by_member_id && turn.date < householdDateKey();
}

function canSuspendDay(turn) {
  return ticketAdmin && turn && ["pending", "suspended"].includes(turn.status)
    && !turn.covered_by_member_id && !turn.completed_by_member_id && !turn.completed_at;
}

async function setDaySuspended(turnId, messageId = "calendar-admin-message") {
  const turn = turns.find(item => item.id === turnId);
  if (daySuspensionSaving || pastTurnSaving || !canSuspendDay(turn)) return;
  const suspend = turn.status === "pending";
  const date = formatLongDate(parseDateKey(turn.date));
  const question = suspend
    ? `¿Suspender el ${date}? No habrá lavado ese día. El resto del calendario y los tickets siguen igual.`
    : `¿Reactivar el ${date}? El turno de ${memberName(turn.assigned_member_id)} volverá a quedar pendiente.`;
  if (!confirm(question)) return;
  daySuspensionSaving = true;
  renderCalendar(); renderToday();
  const message = el(messageId);
  message.textContent = "Guardando…";
  let saved = false;
  try {
    const { error } = await client.rpc("admin_set_day_suspended", {
      p_turn_id: turnId, p_suspended: suspend
    });
    if (error) throw error;
    saved = true;
    await refreshData();
    message.textContent = suspend ? "Día suspendido. Los demás turnos siguen igual." : "Día reactivado.";
  } catch (error) {
    message.textContent = saved
      ? "El cambio se guardó. Recargá la página para actualizar el calendario."
      : error?.code === "P0001"
        ? "El turno cambió o no se puede suspender. Recargá antes de volver a intentar."
        : "No se pudo guardar. Comprobá que instalaste el SQL de suspensión y recargá.";
    if (error?.code === "42501") await loadTicketAdmin();
  } finally {
    daySuspensionSaving = false;
    renderCalendar(); renderToday();
  }
}

async function completePastTurn(turnId) {
  const turn = turns.find(item => item.id === turnId);
  if (pastTurnSaving || daySuspensionSaving || !canCompletePastTurn(turn)) return;
  if (!confirm(`¿Marcar como completado el turno de ${memberName(turn.assigned_member_id)} del ${formatLongDate(parseDateKey(turn.date))}? Quedará registrado que Santi lo confirmó después.`)) return;
  pastTurnSaving = true;
  renderCalendar();
  const message = el("calendar-admin-message");
  message.textContent = "Guardando…";
  let saved = false;
  try {
    const { error } = await client.rpc("admin_complete_past_turn", { p_turn_id: turnId });
    if (error) throw error;
    saved = true;
    await refreshData();
    message.textContent = "Turno completado y registrado en el historial.";
  } catch (error) {
    message.textContent = saved
      ? "El turno se guardó. Recargá la página para actualizar el calendario."
      : error?.code === "P0001"
        ? "Ese turno ya cambió o no es un pendiente pasado. Recargá el calendario."
        : "No se pudo guardar. Comprobá que instalaste el SQL del calendario y recargá la página.";
    if (error?.code === "42501") await loadTicketAdmin();
  } finally {
    pastTurnSaving = false;
    renderCalendar();
  }
}

function renderCalendar(date = currentCalendarDate) {
  currentCalendarDate = new Date(date.getFullYear(), date.getMonth(), 1);
  el("calendar-month-title").textContent = formatMonth(currentCalendarDate);
  el("calendar-admin-hint").classList.toggle("hidden", !ticketAdmin);

  const grid = el("calendar-grid");
  grid.innerHTML = "";

  const year = currentCalendarDate.getFullYear();
  const month = currentCalendarDate.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const mondayIndex = (first.getDay() + 6) % 7;

  for (let i = 0; i < mondayIndex; i++) {
    const empty = document.createElement("div");
    empty.className = "calendar-cell";
    grid.appendChild(empty);
  }

  const todayKey = localDateKey();

  for (let day = 1; day <= last.getDate(); day++) {
    const d = new Date(year, month, day);
    const key = localDateKey(d);
    const turn = turns.find(t => t.date === key);
    const name = turn ? effectiveTurnMember(turn) : "—";
    const meta = MEMBER_META[name] || { colorClass: "" };

    const cell = document.createElement("div");
    cell.className = "calendar-cell active-date";
    if (key === todayKey) cell.classList.add("today");

    cell.innerHTML = `
      <div class="day-number">${day}</div>
      <div class="member-label">
        <span class="member-dot ${meta.colorClass}"></span>${name}
      </div>
      <div class="turn-label">${turn ? humanStatus(turn.status) : "Sin datos"}</div>
    `;
    if (canCompletePastTurn(turn)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "calendar-complete-button";
      button.textContent = "✓";
      const label = `Completar turno de ${name} del ${formatLongDate(d)}`;
      button.setAttribute("aria-label", label);
      button.title = label;
      button.disabled = pastTurnSaving || daySuspensionSaving;
      button.addEventListener("click", () => completePastTurn(turn.id));
      cell.appendChild(button);
    }
    if (canSuspendDay(turn)) {
      const button = document.createElement("button");
      const suspended = turn.status === "suspended";
      button.type = "button";
      button.className = "calendar-suspend-button";
      button.textContent = suspended ? "▶" : "Ⅱ";
      const label = `${suspended ? "Reactivar" : "Suspender"} el día ${formatLongDate(d)}`;
      button.setAttribute("aria-label", label);
      button.title = label;
      button.disabled = pastTurnSaving || daySuspensionSaving;
      button.addEventListener("click", () => setDaySuspended(turn.id));
      cell.appendChild(button);
    }
    grid.appendChild(cell);
  }
}

function renderOffers() {
  const host = el("offers-list");
  if (!host) return;

  const today = localDateKey();

  const available = turns.filter(t =>
    t.status === "offered" &&
    t.date >= today
  );

  if (!available.length) {
    host.innerHTML = `<div class="empty-offers">No hay turnos publicados por ahora.</div>`;
    return;
  }

  host.innerHTML = available.map(turn => {
    const owner = memberName(turn.assigned_member_id);
    const isMine = turn.assigned_member_id === currentMember.id;
    const d = parseDateKey(turn.date);

    return `
      <div class="offer-row">
        <div class="offer-main">
          <strong>${owner} · ${formatLongDate(d)}</strong>
          <small>${turn.ticket_price} ticket · turno publicado</small>
        </div>
        <button
          class="accept-offer-button"
          data-turn-id="${turn.id}"
          ${isMine ? "disabled" : ""}
        >
          ${isMine ? "Tu turno" : "Aceptar"}
        </button>
      </div>
    `;
  }).join("");

  host.querySelectorAll(".accept-offer-button[data-turn-id]").forEach(btn => {
    btn.addEventListener("click", () => acceptTurn(btn.dataset.turnId));
  });
}

async function renderHistory() {
  const { data, error } = await client
    .from("history")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.warn(error);
    return;
  }

  const entries = data || [];
  el("history-count").textContent =
    `${entries.length} movimiento${entries.length === 1 ? "" : "s"}`;

  const host = el("history-list");

  if (!entries.length) {
    host.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">◴</div>
        <h3>Una historia por empezar.</h3>
        <p>Las confirmaciones, ofertas y ausencias aparecerán aquí.</p>
      </div>
    `;
    return;
  }

  const labels = {
    turn_published: "publicó su turno",
    turn_accepted: "aceptó cubrir un turno",
    turn_completed: "confirmó los platos lavados",
    absence_declared: "declaró ausencia"
  };

  host.replaceChildren();
  for (const entry of entries) {
    const actor = memberName(entry.actor_member_id);
    const label = labels[entry.action] || entry.action;
    const row = document.createElement("div");
    row.className = "history-entry";
    const summary = document.createElement("strong");
    if (entry.action === "ticket_balance_adjusted") {
      const details = entry.details || {};
      summary.textContent = `${actor} ajustó los tickets de ${memberName(details.member_id)}: ${details.previous_balance} → ${details.new_balance}.`;
    } else if (entry.action === "past_turn_completed_by_admin") {
      const details = entry.details || {};
      summary.textContent = `${actor} marcó como completado el turno de ${memberName(details.assigned_member_id)} del ${details.turn_date} (registro posterior).`;
    } else if (entry.action === "day_suspended" || entry.action === "day_reactivated") {
      const details = entry.details || {};
      summary.textContent = `${actor} ${entry.action === "day_suspended" ? "suspendió" : "reactivó"} el día ${details.turn_date}. El resto del calendario sigue igual.`;
    } else {
      summary.textContent = `${actor} ${label}`;
    }
    const time = document.createElement("time");
    time.dateTime = entry.created_at;
    time.textContent = new Intl.DateTimeFormat("es-AR", {
      dateStyle: "short", timeStyle: "short"
    }).format(new Date(entry.created_at));
    row.append(summary, time);
    host.appendChild(row);
  }
}

async function callRpc(name, params) {
  const { error } = await client.rpc(name, params);
  if (error) {
    alert(error.message);
    throw error;
  }
  await refreshData();
}

async function markWashed() {
  if (!todayTurn) return;
  if (!confirm("¿Confirmar que los platos fueron lavados?")) return;
  await callRpc("complete_turn", { p_turn_id: todayTurn.id });
}

async function publishTurn() {
  if (!todayTurn) return;
  if (!confirm(`¿Publicar tu turno por ${todayTurn.ticket_price} ticket?`)) return;
  await callRpc("publish_turn", { p_turn_id: todayTurn.id });
}

async function acceptTurn(turnId) {
  if (!confirm("¿Aceptar este turno? El ticket se transfiere cuando confirmes que lavaste.")) return;
  await callRpc("accept_turn", { p_turn_id: turnId });
}

async function declareAbsence() {
  if (!todayTurn) return;
  if (!confirm("¿Declarar ausencia? El siguiente integrante lava hoy y vos recuperás mañana.")) return;
  await callRpc("declare_absence", { p_turn_id: todayTurn.id });
}

function wireNavigation() {
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  });

  document.querySelectorAll("[data-view-link]").forEach(btn => {
    btn.addEventListener("click", () => setView(btn.dataset.viewLink));
  });
}

function wireCalendarControls() {
  el("calendar-prev").addEventListener("click", () => {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
    renderCalendar(currentCalendarDate);
  });

  el("calendar-next").addEventListener("click", () => {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
    renderCalendar(currentCalendarDate);
  });

  el("calendar-today").addEventListener("click", () => {
    currentCalendarDate = new Date();
    renderCalendar(currentCalendarDate);
  });
}

function wireTheme() {
  el("theme-toggle").addEventListener("click", () => {
    document.body.classList.toggle("light");
    el("theme-toggle").textContent =
      document.body.classList.contains("light")
        ? "☾ Modo oscuro"
        : "☼ Modo claro";
  });
}

async function boot() {
  el("suspend-day-btn").addEventListener("click", () => {
    if (todayTurn) setDaySuspended(todayTurn.id, "day-admin-message");
  });
  el("ticket-admin-form").addEventListener("submit", saveTicketBalance);
  el("ticket-admin-member").addEventListener("change", () => {
    syncTicketAdminBalance();
    el("ticket-admin-message").textContent = "";
  });
  wireNavigation();
  wireCalendarControls();
  wireTheme();

  el("google-login-btn").addEventListener("click", loginWithGoogle);
  el("logout-btn").addEventListener("click", logout);
  el("washed-btn").addEventListener("click", markWashed);
  el("publish-turn-btn").addEventListener("click", publishTurn);
  el("absence-btn").addEventListener("click", declareAbsence);

  currentUser = await getCurrentUser();

  if (!currentUser) {
    showLogin();
    return;
  }

  currentMember = await loadCurrentMember(currentUser);

  if (!currentMember) {
    await client.auth.signOut();
    showLogin("Esta cuenta no pertenece a la familia configurada.");
    return;
  }

  try {
    await refreshData();
    await loadTicketAdmin();
    showApp();
  } catch (error) {
    console.error(error);
    showLogin("No se pudieron cargar los datos de la casa: " + error.message);
  }
}

client.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_OUT" && !session) {
    currentUser = null;
    currentMember = null;
    showLogin();
  }
});

document.addEventListener("DOMContentLoaded", boot);
