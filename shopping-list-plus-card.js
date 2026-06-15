/**
 * Shopping List Plus Card
 * Um custom card para o Home Assistant que assenta numa entidade `todo`
 * (ex.: todo.shopping_list) e adiciona pesquisa, filtros por tag e
 * agrupamento por categoria — sem precisar de backend nenhum.
 *
 * Convenção: usa tags com # no nome do artigo, ex.:
 *   "Leite #laticinios #continente"
 * O card extrai as tags, mostra o nome limpo + badges, e dá-te chips de
 * filtro. As tags ficam guardadas no próprio `summary` do item, por isso
 * fazem round-trip e aparecem em qualquer outro sítio do HA.
 *
 * Config mínima (YAML):
 *   type: custom:shopping-list-plus-card
 *   entity: todo.shopping_list
 *
 * Config completa:
 *   type: custom:shopping-list-plus-card
 *   entity: todo.shopping_list
 *   title: Compras
 *   accent_color: "#d99a2b"      # opcional, default = cor primária do tema
 *   group_by_category: false      # opcional
 *   show_completed: true          # opcional
 */

const TAG_RE = /#([\p{L}\p{N}_-]+)/gu;

class ShoppingListPlusCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._items = [];
    this._loaded = false;
    this._error = null;
    this._search = "";
    this._activeTags = new Set();
    this._groupByCategory = false;
    this._showCompleted = true;
    this._chromeBuilt = false;
    this._subscribedEntity = null;
    this._unsub = null;
  }

  /* ---------------- Lovelace lifecycle ---------------- */

  static getStubConfig() {
    return { entity: "todo.shopping_list", title: "Compras" };
  }

  setConfig(config) {
    if (!config.entity || !config.entity.startsWith("todo.")) {
      throw new Error("Define uma entidade `todo.` (ex.: todo.shopping_list)");
    }
    this._config = {
      title: "Compras",
      group_by_category: false,
      show_completed: true,
      ...config,
    };
    this._groupByCategory = !!this._config.group_by_category;
    this._showCompleted = this._config.show_completed !== false;
    this._loadPrefs();
    this._buildChrome();
    this._applyAccent();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    if (this._subscribedEntity !== this._config.entity) {
      this._teardown();
      this._subscribedEntity = this._config.entity;
      this._subscribe();
    }
  }

  connectedCallback() {
    if (this._hass && this._config && !this._unsub) this._subscribe();
  }

  disconnectedCallback() {
    this._teardown();
  }

  getCardSize() {
    return 4;
  }

  /* ---------------- Data layer ---------------- */

  async _subscribe() {
    if (!this._hass || !this._config) return;
    const entity_id = this._config.entity;
    try {
      const unsub = await this._hass.connection.subscribeMessage(
        (msg) => {
          this._items = (msg && msg.items) || [];
          this._loaded = true;
          this._error = null;
          this._renderDynamic();
        },
        { type: "todo/item/subscribe", entity_id }
      );
      this._unsub = unsub;
    } catch (e) {
      // Fallback: fetch one-shot if subscription isn't supported
      try {
        const res = await this._hass.callWS({ type: "todo/item/list", entity_id });
        this._items = (res && res.items) || [];
        this._loaded = true;
        this._renderDynamic();
      } catch (e2) {
        this._error = e2;
        this._renderDynamic();
      }
    }
  }

  _teardown() {
    if (this._unsub) {
      try { this._unsub(); } catch (_) {}
      this._unsub = null;
    }
  }

  _callService(service, data) {
    return this._hass.callService("todo", service, data, {
      entity_id: this._config.entity,
    });
  }

  _addItem(raw) {
    const summary = raw.trim();
    if (!summary) return;
    this._callService("add_item", { item: summary });
  }

  _toggleItem(uid, status) {
    this._callService("update_item", {
      item: uid,
      status: status === "completed" ? "needs_action" : "completed",
    });
  }

  _removeItem(uid) {
    this._callService("remove_item", { item: uid });
  }

  /* ---------------- Parsing helpers ---------------- */

  _parse(item) {
    const summary = item.summary || "";
    const tags = new Set();
    let m;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(summary)) !== null) tags.add(m[1].toLowerCase());
    if (item.description) {
      item.description
        .split(/[,;]/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
        .forEach((t) => tags.add(t));
    }
    const name = summary.replace(TAG_RE, "").replace(/\s{2,}/g, " ").trim();
    return {
      uid: item.uid,
      name: name || summary,
      tags: [...tags],
      status: item.status,
      done: item.status === "completed",
    };
  }

  _allParsed() {
    return this._items.map((i) => this._parse(i));
  }

  _allTags() {
    const set = new Set();
    let hasUncategorized = false;
    for (const it of this._allParsed()) {
      if (it.tags.length === 0) hasUncategorized = true;
      it.tags.forEach((t) => set.add(t));
    }
    const tags = [...set].sort((a, b) => a.localeCompare(b, "pt"));
    return { tags, hasUncategorized };
  }

  _matchesFilters(it) {
    if (!this._showCompleted && it.done) return false;
    if (this._search) {
      const q = this._search.toLowerCase();
      if (!it.name.toLowerCase().includes(q) &&
          !it.tags.some((t) => t.includes(q))) return false;
    }
    if (this._activeTags.size > 0) {
      const wantsUncat = this._activeTags.has("__uncat__");
      const tagMatch = it.tags.some((t) => this._activeTags.has(t));
      const uncatMatch = wantsUncat && it.tags.length === 0;
      if (!tagMatch && !uncatMatch) return false;
    }
    return true;
  }

  /* ---------------- Preferences (localStorage) ---------------- */

  _prefsKey() {
    return `slpc:${this._config.entity}`;
  }

  _loadPrefs() {
    try {
      const raw = window.localStorage.getItem(this._prefsKey());
      if (!raw) return;
      const p = JSON.parse(raw);
      if (Array.isArray(p.activeTags)) this._activeTags = new Set(p.activeTags);
      if (typeof p.group === "boolean") this._groupByCategory = p.group;
      if (typeof p.showCompleted === "boolean") this._showCompleted = p.showCompleted;
    } catch (_) {}
  }

  _savePrefs() {
    try {
      window.localStorage.setItem(this._prefsKey(), JSON.stringify({
        activeTags: [...this._activeTags],
        group: this._groupByCategory,
        showCompleted: this._showCompleted,
      }));
    } catch (_) {}
  }

  /* ---------------- Rendering: static chrome ---------------- */

  _applyAccent() {
    const accent = this._config.accent_color;
    if (accent) this.style.setProperty("--slpc-accent", accent);
  }

  _buildChrome() {
    if (this._chromeBuilt) {
      // title may have changed
      const t = this.shadowRoot.querySelector(".title");
      if (t) t.textContent = this._config.title;
      return;
    }
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          --slpc-accent: var(--primary-color);
          --slpc-radius: 12px;
        }
        ha-card { padding: 16px; }
        .header {
          display: flex; align-items: baseline; justify-content: space-between;
          gap: 12px; margin-bottom: 14px;
        }
        .title {
          font-size: 1.3rem; font-weight: 600; color: var(--primary-text-color);
          letter-spacing: -0.01em;
        }
        .counts { font-size: 0.8rem; color: var(--secondary-text-color); white-space: nowrap; }
        .counts b { color: var(--slpc-accent); }

        .add-row { display: flex; gap: 8px; margin-bottom: 10px; }
        input.field {
          flex: 1; min-width: 0;
          background: var(--secondary-background-color, rgba(127,127,127,0.1));
          border: 1px solid var(--divider-color, rgba(127,127,127,0.2));
          color: var(--primary-text-color);
          border-radius: var(--slpc-radius); padding: 10px 14px; font-size: 0.95rem;
          outline: none; transition: border-color 0.15s;
        }
        input.field:focus { border-color: var(--slpc-accent); }
        .add-btn {
          flex: 0 0 auto; border: none; cursor: pointer;
          background: var(--slpc-accent); color: var(--text-primary-color, #fff);
          border-radius: var(--slpc-radius); padding: 0 16px; font-size: 1.3rem; line-height: 1;
          font-weight: 500;
        }
        .add-btn:active { transform: translateY(1px); }

        .toolbar { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
        .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
        .chip {
          cursor: pointer; user-select: none;
          border: 1px solid var(--divider-color, rgba(127,127,127,0.3));
          background: transparent; color: var(--secondary-text-color);
          border-radius: 999px; padding: 4px 12px; font-size: 0.8rem;
          transition: all 0.12s;
        }
        .chip:hover { border-color: var(--slpc-accent); }
        .chip.active {
          background: var(--slpc-accent); border-color: var(--slpc-accent);
          color: var(--text-primary-color, #fff);
        }
        .toggle {
          cursor: pointer; user-select: none; font-size: 0.78rem;
          border: 1px solid var(--divider-color, rgba(127,127,127,0.3));
          background: transparent; color: var(--secondary-text-color);
          border-radius: 8px; padding: 5px 10px; transition: all 0.12s;
        }
        .toggle.active { color: var(--slpc-accent); border-color: var(--slpc-accent); }

        .group-label {
          font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em;
          color: var(--secondary-text-color); margin: 14px 4px 6px;
          border-bottom: 1px solid var(--divider-color, rgba(127,127,127,0.15));
          padding-bottom: 4px;
        }
        .row {
          display: flex; align-items: center; gap: 12px;
          padding: 9px 4px; border-radius: 8px;
        }
        .row:hover { background: var(--secondary-background-color, rgba(127,127,127,0.07)); }
        .check {
          flex: 0 0 auto; width: 22px; height: 22px; border-radius: 6px; cursor: pointer;
          border: 2px solid var(--divider-color, rgba(127,127,127,0.4));
          display: flex; align-items: center; justify-content: center;
          color: #fff; font-size: 14px; line-height: 1; transition: all 0.12s;
        }
        .check.done { background: var(--slpc-accent); border-color: var(--slpc-accent); }
        .name { flex: 1; min-width: 0; color: var(--primary-text-color); font-size: 0.96rem; }
        .row.done .name { text-decoration: line-through; color: var(--secondary-text-color); }
        .badges { display: flex; gap: 4px; flex-wrap: wrap; }
        .badge {
          font-size: 0.68rem; color: var(--secondary-text-color);
          border: 1px solid var(--divider-color, rgba(127,127,127,0.25));
          border-radius: 999px; padding: 1px 8px; white-space: nowrap;
        }
        .del {
          flex: 0 0 auto; cursor: pointer; border: none; background: none;
          color: var(--secondary-text-color); font-size: 1.1rem; opacity: 0;
          padding: 2px 6px; transition: opacity 0.12s, color 0.12s;
        }
        .row:hover .del { opacity: 0.6; }
        .del:hover { color: var(--error-color, #db4437); opacity: 1; }

        .empty, .msg {
          text-align: center; color: var(--secondary-text-color);
          padding: 28px 12px; font-size: 0.9rem;
        }
      </style>
      <ha-card>
        <div class="header">
          <span class="title"></span>
          <span class="counts"></span>
        </div>
        <div class="add-row">
          <input class="field add-input" type="text"
                 placeholder="Adicionar artigo…  (ex.: Leite #laticínios)" />
          <button class="add-btn" title="Adicionar">+</button>
        </div>
        <input class="field search-input" type="text" placeholder="Procurar…" style="margin-bottom:10px;" />
        <div class="toolbar">
          <button class="toggle t-group">Agrupar</button>
          <button class="toggle t-done">Concluídos</button>
        </div>
        <div class="chips"></div>
        <div class="list"></div>
      </ha-card>
    `;

    const $ = (s) => this.shadowRoot.querySelector(s);
    $(".title").textContent = this._config.title;

    const addInput = $(".add-input");
    $(".add-btn").addEventListener("click", () => {
      this._addItem(addInput.value);
      addInput.value = "";
      addInput.focus();
    });
    addInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        this._addItem(addInput.value);
        addInput.value = "";
      }
    });

    $(".search-input").addEventListener("input", (e) => {
      this._search = e.target.value;
      this._renderList();
    });

    const tGroup = $(".t-group");
    const tDone = $(".t-done");
    tGroup.classList.toggle("active", this._groupByCategory);
    tDone.classList.toggle("active", this._showCompleted);
    tGroup.addEventListener("click", () => {
      this._groupByCategory = !this._groupByCategory;
      tGroup.classList.toggle("active", this._groupByCategory);
      this._savePrefs();
      this._renderList();
    });
    tDone.addEventListener("click", () => {
      this._showCompleted = !this._showCompleted;
      tDone.classList.toggle("active", this._showCompleted);
      this._savePrefs();
      this._renderList();
    });

    // Event delegation for list actions
    $(".list").addEventListener("click", (e) => {
      const el = e.target.closest("[data-action]");
      if (!el) return;
      const uid = el.dataset.uid;
      if (el.dataset.action === "toggle") {
        this._toggleItem(uid, el.dataset.status);
      } else if (el.dataset.action === "delete") {
        this._removeItem(uid);
      }
    });

    // Chips delegation
    $(".chips").addEventListener("click", (e) => {
      const el = e.target.closest(".chip");
      if (!el) return;
      const tag = el.dataset.tag;
      if (this._activeTags.has(tag)) this._activeTags.delete(tag);
      else this._activeTags.add(tag);
      this._savePrefs();
      this._renderDynamic();
    });

    this._chromeBuilt = true;
  }

  /* ---------------- Rendering: dynamic parts ---------------- */

  _renderDynamic() {
    if (!this._chromeBuilt) return;
    this._renderChips();
    this._renderList();
    this._renderCounts();
  }

  _renderCounts() {
    const parsed = this._allParsed();
    const todo = parsed.filter((i) => !i.done).length;
    const done = parsed.filter((i) => i.done).length;
    const el = this.shadowRoot.querySelector(".counts");
    el.innerHTML = `<b>${todo}</b> por comprar · ${done} no carrinho`;
  }

  _renderChips() {
    const { tags, hasUncategorized } = this._allTags();
    const container = this.shadowRoot.querySelector(".chips");
    const parts = [];
    for (const t of tags) {
      const active = this._activeTags.has(t) ? " active" : "";
      parts.push(`<span class="chip${active}" data-tag="${esc(t)}">${esc(t)}</span>`);
    }
    if (hasUncategorized) {
      const active = this._activeTags.has("__uncat__") ? " active" : "";
      parts.push(`<span class="chip${active}" data-tag="__uncat__">sem categoria</span>`);
    }
    container.innerHTML = parts.join("");
  }

  _renderList() {
    const list = this.shadowRoot.querySelector(".list");

    if (this._error) {
      list.innerHTML = `<div class="msg">Erro ao ler a lista: ${esc(String(this._error.message || this._error))}</div>`;
      return;
    }
    if (!this._loaded) {
      list.innerHTML = `<div class="msg">A carregar…</div>`;
      return;
    }

    const visible = this._allParsed().filter((i) => this._matchesFilters(i));
    if (visible.length === 0) {
      list.innerHTML = `<div class="empty">Nada por aqui. 🛒</div>`;
      return;
    }

    if (this._groupByCategory) {
      list.innerHTML = this._renderGrouped(visible);
    } else {
      const sorted = [...visible].sort((a, b) => Number(a.done) - Number(b.done));
      list.innerHTML = sorted.map((i) => this._rowHtml(i)).join("");
    }
  }

  _renderGrouped(items) {
    const groups = new Map();
    for (const it of items) {
      const key = it.tags.length ? it.tags[0] : "sem categoria";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(it);
    }
    const keys = [...groups.keys()].sort((a, b) => {
      if (a === "sem categoria") return 1;
      if (b === "sem categoria") return -1;
      return a.localeCompare(b, "pt");
    });
    return keys.map((k) => {
      const rows = groups.get(k)
        .sort((a, b) => Number(a.done) - Number(b.done))
        .map((i) => this._rowHtml(i)).join("");
      return `<div class="group-label">${esc(k)}</div>${rows}`;
    }).join("");
  }

  _rowHtml(it) {
    const badges = it.tags.map((t) => `<span class="badge">${esc(t)}</span>`).join("");
    return `
      <div class="row${it.done ? " done" : ""}">
        <div class="check${it.done ? " done" : ""}" data-action="toggle"
             data-uid="${esc(it.uid)}" data-status="${esc(it.status)}">${it.done ? "✓" : ""}</div>
        <div class="name">${esc(it.name)}</div>
        <div class="badges">${badges}</div>
        <button class="del" data-action="delete" data-uid="${esc(it.uid)}" title="Remover">×</button>
      </div>
    `;
  }
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

customElements.define("shopping-list-plus-card", ShoppingListPlusCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "shopping-list-plus-card",
  name: "Shopping List Plus",
  description: "Lista de compras com pesquisa, filtros por tag e agrupamento, em cima de uma entidade todo.",
  preview: false,
  documentationURL: "https://developers.home-assistant.io/docs/frontend/custom-ui/custom-card",
});

console.info("%c SHOPPING-LIST-PLUS-CARD %c v1.0 ",
  "color:#fff;background:#d99a2b;border-radius:3px 0 0 3px;padding:2px 4px",
  "color:#d99a2b;background:#222;border-radius:0 3px 3px 0;padding:2px 4px");
