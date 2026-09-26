// Shared shopping list. Supabase RLS authorizes family membership on every request.
(() => {
  const table = "plato_shopping_items";
  const $ = id => document.getElementById(id);
  const state = { items: [], ready: false, loading: false, saving: false, problem: false, epoch: 0, timer: null };
  const visible = () => $("view-shopping").classList.contains("active-view") && !$("app").classList.contains("hidden");
  const allowed = () => Boolean(currentMember && currentUser);

  function message(text, error = false) {
    $("shopping-message").textContent = text;
    $("shopping-message").classList.toggle("shopping-error", error);
  }

  function render() {
    const disabled = !state.ready || state.problem || state.saving || state.loading;
    $("shopping-fields").disabled = !state.ready || state.problem || state.saving;
    $("shopping-form").querySelector('button[type="submit"]').disabled = disabled;
    $("shopping-refresh").disabled = state.loading || state.saving;
    if (state.loading && !state.ready) $("shopping-count").textContent = "Cargando lista…";
    else if (!state.ready) $("shopping-count").textContent = "Lista no disponible";
    else {
      const pending = state.items.filter(item => !item.purchased).length;
      $("shopping-count").textContent = `${pending} por comprar · ${state.items.length - pending} comprados`;
    }
    $("shopping-pending").replaceChildren();
    $("shopping-done").replaceChildren();
    for (const item of state.items) {
      const row = document.createElement("li");
      row.className = `shopping-row${item.purchased ? " is-purchased" : ""}`;
      const label = document.createElement("label");
      label.className = "shopping-check";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = item.purchased;
      checkbox.disabled = disabled;
      checkbox.setAttribute("aria-label", `${item.purchased ? "Volver a necesitar" : "Marcar como comprado"}: ${item.name}`);
      checkbox.addEventListener("change", () => changePurchased(item));
      const text = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = item.name;
      const quantity = document.createElement("small");
      quantity.textContent = `${item.quantity} · Agregó ${memberName(item.created_by)}`;
      text.append(name, quantity);
      label.append(checkbox, text);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "shopping-remove";
      remove.textContent = "Quitar";
      remove.disabled = disabled;
      remove.setAttribute("aria-label", `Quitar ${item.name}`);
      remove.addEventListener("click", () => removeItem(item));
      row.append(label, remove);
      $(item.purchased ? "shopping-done" : "shopping-pending").appendChild(row);
    }
    const done = state.items.filter(item => item.purchased).length;
    $("shopping-done-section").hidden = done === 0;
    $("shopping-done-title").textContent = `Comprados (${done}) · podés volver a necesitarlos`;
    if (state.ready && !state.items.some(item => !item.purchased)) {
      const empty = document.createElement("li");
      empty.className = "shopping-empty";
      empty.textContent = done ? "¡Todo comprado! Agregá lo que falte para la próxima." : "Todavía no falta nada. Agregá el primer producto arriba.";
      $("shopping-pending").appendChild(empty);
    }
  }

  async function load(notice = "") {
    if (!allowed() || state.loading || state.saving) return false;
    const epoch = state.epoch;
    state.loading = true;
    render();
    try {
      const items = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await client.from(table)
          .select("id,name,quantity,purchased,created_by,created_at,updated_at")
          .order("created_at", { ascending: true }).order("id", { ascending: true })
          .range(offset, offset + 499);
        if (error) throw error;
        items.push(...(data || []));
        if (!data || data.length < 500) break;
      }
      if (epoch !== state.epoch || !allowed()) return false;
      state.items = items;
      state.ready = true;
      state.problem = false;
      if (notice) message(notice);
      else message("Lista actualizada.");
      return true;
    } catch (error) {
      if (epoch !== state.epoch) return false;
      state.problem = true;
      const missing = ["42P01", "PGRST205"].includes(error?.code);
      message(missing
        ? "La lista todavía no está instalada. Ejecutá el SQL de Compras en Supabase y tocá Actualizar."
        : "No pudimos actualizar la lista. Revisá la conexión y tocá Actualizar; tus productos siguen guardados.", true);
      return false;
    } finally {
      if (epoch === state.epoch) { state.loading = false; render(); }
    }
  }

  async function write(operation, notice, afterSave) {
    if (!allowed() || !state.ready || state.saving || state.loading || state.problem) return;
    const epoch = state.epoch;
    state.saving = true;
    render();
    message("Guardando…");
    let saved = false;
    let conflict = false;
    try {
      const { data, error } = await operation();
      if (error) throw error;
      if (!data?.length) { conflict = true; throw new Error("Changed or removed"); }
      if (epoch !== state.epoch) return;
      saved = true;
      afterSave?.();
    } catch (_) {
      // A network interruption can occur after a commit: reload before retrying.
    } finally {
      if (epoch === state.epoch) {
        state.saving = false;
        const refreshed = await load(saved ? notice : "");
        if (epoch !== state.epoch) return;
        if (!saved) message(conflict
          ? "Otra persona cambió o quitó ese producto. Revisá la lista actualizada."
          : "No pudimos confirmar el cambio. Revisá la lista antes de volver a intentarlo.", true);
        else if (!refreshed) message("El cambio se guardó, pero no pudimos refrescar la lista. Tocá Actualizar.", true);
      }
    }
  }

  async function add(event) {
    event.preventDefault();
    const name = $("shopping-name").value.trim();
    const quantity = $("shopping-quantity").value.trim() || "1";
    if (!name || name.length > 120 || quantity.length > 60) {
      message("Ingresá un producto de hasta 120 caracteres y una cantidad de hasta 60.", true);
      return;
    }
    await write(() => client.from(table).insert({ name, quantity }).select("id"), "Producto agregado.", () => {
      $("shopping-form").reset();
    });
    if (visible() && !state.problem) $("shopping-name").focus();
  }

  async function changePurchased(item) {
    await write(() => client.from(table).update({ purchased: !item.purchased })
      .eq("id", item.id).eq("updated_at", item.updated_at).select("id"),
    item.purchased ? "Producto devuelto a la lista." : "Producto marcado como comprado.");
  }

  async function removeItem(item) {
    if (!confirm(`¿Quitar «${item.name}» de la lista de compras?`)) return;
    await write(() => client.from(table).delete()
      .eq("id", item.id).eq("updated_at", item.updated_at).select("id"), "Producto quitado.");
  }

  function close() { clearInterval(state.timer); state.timer = null; }
  function open() {
    close();
    load();
    state.timer = setInterval(() => {
      if (visible() && document.visibilityState === "visible") load();
    }, 15000);
  }
  function reset() {
    close();
    state.epoch++;
    Object.assign(state, { items: [], ready: false, loading: false, saving: false, problem: false });
    $("shopping-form").reset();
    message("");
    render();
  }
  window.PlatoShopping = { open, close, reset };
  document.addEventListener("DOMContentLoaded", () => {
    $("shopping-form").addEventListener("submit", add);
    $("shopping-refresh").addEventListener("click", () => load());
    document.addEventListener("visibilitychange", () => {
      if (visible() && document.visibilityState === "visible") load();
    });
    window.addEventListener("focus", () => { if (visible()) load(); });
    render();
  });
})();
