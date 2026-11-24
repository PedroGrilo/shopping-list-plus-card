/**
 * Shopping List Plus Card  —  v1.8.1
 * Um custom card para o Home Assistant que assenta numa entidade `todo`
 * (ex.: todo.lista_de_compras) com pesquisa, filtros por categoria,
 * agrupamento, quantidades, recomendações e categorização automática.
 *
 * Modelo de dados:
 *   - nome + quantidade ficam no `summary` (quantidade como prefixo "2x ")
 *   - categoria (uma por artigo) fica no campo `description` do item.
 *     Se a lista não suportar `description`, a categoria é guardada como
 *     sufixo "[Categoria]" no nome.
 *   - o histórico de compras (para as recomendações) fica no browser e, se
 *     possível, nos dados do utilizador do HA (sincroniza entre dispositivos).
 *
 * Config mínima (YAML):
 *   type: custom:shopping-list-plus-card
 *   entity: todo.lista_de_compras
 *
 * Config completa:
 *   type: custom:shopping-list-plus-card
 *   entity: todo.lista_de_compras
 *   title: Compras
 *   accent_color: "#7B8CFF"      # opcional, default = cor primária do tema
 *   group_by_category: false      # opcional
 *   show_completed: true          # opcional
 *   recommendations: 8            # opcional, nº de recomendações (0 = desligar)
 *   auto_category: true           # opcional, adivinha a categoria pelo nome
 *   continente: sensor.continente_estimativa_da_lista_de_compras
 *                                 # opcional: preços e "Enviar para o Continente" (integração
 *                                 # ha-continente). Deteta-se sozinho; `continente: false` desliga.
 */

const VERSION = "1.8.1";
const TAG_RE = /#([\p{L}\p{N}_-]+)/gu;               // só para limpar legado
// prefixo de quantidade: "2x Ovos", "2 x ovos" ou "2 ovos" (sem "x" só se a seguir vier minúscula,
// para não estragar nomes como "7 Up" ou "100 Montaditos")
const QTY_RE = /^\s*(\d{1,3})(?:\s*[xX×*]\s*|\s+(?=\p{Ll}))(?=\S)/u;
const BRACKET_RE = /\s*\[([^\]]+)\]\s*$/;             // sufixo [Categoria] (fallback)
const FEAT_SET_DESCRIPTION = 64;                      // TodoListEntityFeature
const MAX_QTY = 999;
const UNCAT = "__uncat__";
const DAY = 86400000;
const SESSION_GAP = 3 * 3600000;                      // compras com < 3h de distância = mesma ida às compras
const HISTORY_LEN = 12;
const EUR = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });
const fmtEur = (v) => (v == null || isNaN(v) ? "" : EUR.format(v));

/** minúsculas, sem acentos, espaços normalizados (com cache: é chamada milhares de vezes por render) */
const NORM_CACHE = new Map();
function norm(s) {
  const k = String(s || "");
  let v = NORM_CACHE.get(k);
  if (v !== undefined) return v;
  v = k.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  if (NORM_CACHE.size > 5000) NORM_CACHE.clear();
  NORM_CACHE.set(k, v);
  return v;
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function clampQty(q) {
  return Math.min(MAX_QTY, Math.max(1, parseInt(q, 10) || 1));
}

/* Quantidades por extenso (ditado por voz): "dois ovos", "vinte e quatro ovos", "meia dúzia de ovos". */
const QTY_WORDS = {
  "meia duzia": 6, "uma duzia": 12, "duas duzias": 24, duzias: 12, duzia: 12,
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8,
  nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14, quinze: 15, vinte: 20, trinta: 30,
};
const QTY_WORD_RE = new RegExp(
  `^(${Object.keys(QTY_WORDS).sort((a, b) => b.length - a.length).join("|").replace(/ /g, "\\s+")})\\s+(?:de\\s+)?`
);
const QTY_UNIT_RE = /^e\s+(um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove)\s+(?:de\s+)?/;
const fold = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * "2x ovos" / "2 ovos" / "dois ovos" -> { qty: 2, name: "ovos" }; "7 Up" -> { qty: null, name: "7 Up" }.
 * Por extenso só conta se o nome a seguir começar por minúscula ("Um Bongo", "Duas Quintas" ficam intactos).
 * `dozen` = era "dúzia(s)", que multiplica um número anterior ("2 dúzias de ovos" = 24).
 */
function splitQty(text) {
  const t = String(text || "").trim();
  const m = t.match(QTY_RE);
  if (m) return { qty: clampQty(m[1]), name: t.slice(m[0].length).trim() };
  const folded = fold(t);
  if (folded.length !== t.length) return { qty: null, name: t };   // texto em forma decomposta: não arriscar
  const lower = folded.toLowerCase();
  const w = lower.match(QTY_WORD_RE);
  if (!w) return { qty: null, name: t };
  const word = w[1].replace(/\s+/g, " ");
  let qty = QTY_WORDS[word];
  let cut = w[0].length;
  if (word === "vinte" || word === "trinta") {
    const u = lower.slice(cut).match(QTY_UNIT_RE);
    if (u) { qty += QTY_WORDS[u[1]]; cut += u[0].length; }
  }
  const rest = t.slice(cut).trim();
  if (!rest || !/^\p{Ll}/u.test(rest)) return { qty: null, name: t };
  return { qty: clampQty(qty), name: rest, dozen: word === "duzia" || word === "duzias" };
}

/** Limpa o que vem do ditado: pontuação final e espaços a mais. */
function cleanDictated(text) {
  return String(text || "").replace(/[.!?…]+\s*$/u, "").replace(/\s{2,}/g, " ").trim();
}

/** Quantidade + nome limpo: "Dois ovos." -> 2/"ovos"; "2 dúzias de ovos" -> 24/"ovos"; "Leite" -> null/"Leite". */
function qtyAndName(text) {
  const a = splitQty(cleanDictated(text));
  const b = splitQty(a.name);
  if (a.qty && b.qty && b.dozen) return { qty: clampQty(a.qty * b.qty), name: b.name };
  return { qty: a.qty, name: a.name };
}

/* Artigos adicionados por um card neste browser (todas as instâncias): "entidade|summary" -> expira. */
const RECENT_LOCAL = new Map();
function markLocal(entity, summary) {
  const now = Date.now();
  for (const [k, t] of RECENT_LOCAL) if (t < now) RECENT_LOCAL.delete(k);
  RECENT_LOCAL.set(`${entity}|${summary}`, now + 30000);
}

/** Divide uma entrada com várias linhas/vírgulas/";" em vários artigos. */
function splitMulti(text) {
  return String(text || "")
    .split(/\n|;|,(?!\d)/)          // "1,5L" não é separado
    .map((s) => s.trim())
    .filter(Boolean);
}

/* Dicionário para categorização automática (palavras sem acentos). */
const AUTO_CATS = {
  "Frutas e Legumes": ["banana", "maca", "pera", "laranja", "limao", "lima", "uva", "morango", "kiwi", "ananas", "manga", "melao", "melancia", "pessego", "ameixa", "cereja", "framboesa", "mirtilo", "abacate", "tomate", "alface", "cebola", "alho", "batata", "cenoura", "courgette", "curgete", "pepino", "pimento", "brocolos", "couve", "espinafre", "rucula", "cogumelo", "abobora", "beringela", "feijao verde", "salsa", "coentros", "hortela", "manjericao", "nabo", "alho frances", "fruta", "legumes", "salada"],
  "Laticínios e Ovos": ["leite", "iogurte", "queijo", "manteiga", "natas", "requeijao", "mozzarella", "mozarela", "parmesao", "kefir", "ovo", "ovos", "margarina", "skyr"],
  "Padaria": ["pao", "paes", "baguete", "broa", "croissant", "bolo", "tosta", "tostas", "regueifa", "carcaca", "bolacha", "bolachas", "biscoito", "torrada", "wrap", "tortilha", "pao de forma"],
  "Talho": ["frango", "peru", "carne", "bife", "bifes", "porco", "vaca", "novilho", "borrego", "costeleta", "entrecosto", "picada", "hamburguer", "salsicha", "salsichas", "chourico", "fiambre", "presunto", "bacon", "febras", "lombo", "perna"],
  "Peixaria": ["peixe", "bacalhau", "salmao", "atum", "pescada", "dourada", "robalo", "sardinha", "sardinhas", "camarao", "lulas", "polvo", "choco", "marisco", "carapau", "filetes"],
  "Mercearia": ["arroz", "massa", "esparguete", "farinha", "acucar", "sal", "azeite", "oleo", "vinagre", "cafe", "cha", "cereais", "aveia", "feijao", "grao", "lentilhas", "molho", "ketchup", "maionese", "mostarda", "enlatados", "conserva", "mel", "compota", "chocolate", "cacau", "fermento", "especiarias", "pimenta", "oregaos", "caldo", "pure", "tremoco", "batatas fritas", "snacks", "frutos secos", "amendoins", "nozes", "amendoas", "polpa"],
  "Congelados": ["congelado", "congelados", "gelado", "gelados", "pizza", "ervilhas", "douradinhos", "nuggets", "gelo"],
  "Bebidas": ["agua", "sumo", "refrigerante", "cola", "coca cola", "sprite", "fanta", "7 up", "ice tea", "cerveja", "vinho", "espumante", "whisky", "gin", "vodka", "licor", "bebida"],
  "Limpeza": ["detergente", "lixivia", "amaciador", "esfregao", "esponja", "lava loica", "loica", "sacos do lixo", "sacos lixo", "papel de cozinha", "rolo de cozinha", "limpa vidros", "desengordurante", "pastilhas", "sabao", "panos", "luvas", "ambientador", "insecticida", "inseticida", "pilhas", "lampada", "aluminio", "pelicula"],
  "Higiene": ["papel higienico", "champo", "shampoo", "gel de banho", "sabonete", "pasta de dentes", "escova de dentes", "desodorizante", "lamina", "laminas", "algodao", "cotonetes", "pensos", "tampoes", "creme", "protetor solar", "lencos", "fio dental", "elixir", "cotonete"],
  "Bebé": ["fraldas", "toalhitas", "papa", "papas", "leite em po", "biberao"],
  "Animais": ["racao", "comida gato", "comida cao", "areia gato", "areia", "petiscos cao", "petiscos gato"],
};

/* Lista de arranque para as recomendações quando ainda não há histórico. */
const STAPLES = [
  ["Leite", "Laticínios e Ovos"], ["Pão", "Padaria"], ["Ovos", "Laticínios e Ovos"],
  ["Bananas", "Frutas e Legumes"], ["Iogurtes", "Laticínios e Ovos"], ["Queijo", "Laticínios e Ovos"],
  ["Tomate", "Frutas e Legumes"], ["Arroz", "Mercearia"], ["Massa", "Mercearia"],
  ["Café", "Mercearia"], ["Água", "Bebidas"], ["Papel higiénico", "Higiene"],
];

/** Lista (palavra, categoria) ordenada da mais longa para a mais curta. */
const AUTO_INDEX = Object.entries(AUTO_CATS)
  .flatMap(([cat, words]) => words.map((w) => [w, cat]))
  .sort((a, b) => b[0].length - a[0].length);

function guessCategory(name) {
  const n = ` ${norm(name).replace(/[^a-z0-9 ]/g, " ")} `;
  for (const [w, cat] of AUTO_INDEX) {
    if (n.includes(` ${w} `) || n.includes(` ${w}s `) || n.includes(` ${w}es `)) return cat;
  }
  return "";
}

class ShoppingListPlusCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._items = [];
    this._loaded = false;
    this._error = null;
    this._search = "";
    this._activeCats = new Set();
    this._groupByCategory = false;
    this._showCompleted = true;
    this._chromeBuilt = false;
    this._subscribedEntity = null;
    this._unsub = null;
    this._subGen = 0;            // geração da subscrição: respostas de gerações antigas são ignoradas
    this._subPending = false;
    this._live = false;          // true = subscrição em tempo real ativa
    this._pollTimer = null;
    this._healTimer = null;
    this._healedFor = null;      // valor do estado para o qual já tentámos corrigir
    this._entityAvailable = true;
    this._catalog = {};
    this._cats = new Set();
    this._prevStatus = null;     // uid -> status (para aprender o que foi comprado)
    this._remoteLoaded = false;
    this._remoteSaveTimer = null;
    this._suggestions = [];
    this._sugIndex = -1;
    this._catOptions = [];
    this._catIndex = -1;
    this._catAuto = false;       // categoria preenchida automaticamente (pode ser substituída)
    this._restoring = [];        // artigos a repor por "Desfazer": {summary, done, expires, uid}
    this._seen = null;           // uids já vistos (para detetar o que foi adicionado com o card fechado)
    this._toastTimer = null;
    this._onVisible = () => {
      if (document.visibilityState === "visible" && this._loaded) { this._syncSeen(); this._refresh(); }
    };
  }

  /* ---------------- Lovelace lifecycle ---------------- */

  static getStubConfig(hass) {
    const ids = Object.keys((hass && hass.states) || {}).filter((id) => id.startsWith("todo."));
    const entity = ids.find((id) => /compra|shopping/i.test(id)) || ids[0] || "todo.lista_de_compras";
    return { entity, title: "Compras" };
  }

  /** Editor visual no HA (2024.11+): sem YAML para as opções básicas. */
  static getConfigForm() {
    const labels = {
      entity: "Lista (entidade todo)",
      title: "Título",
      accent_color: "Cor de destaque (opcional, ex.: #d99a2b)",
      group_by_category: "Agrupar por categoria",
      show_completed: "Mostrar comprados",
      auto_category: "Categoria automática",
      recommendations: "Nº de sugestões (0 = desligar)",
      continente: "Continente: sensor de preços (opcional, deteta-se sozinho)",
    };
    return {
      schema: [
        { name: "entity", required: true, selector: { entity: { domain: "todo" } } },
        { name: "title", selector: { text: {} } },
        { name: "accent_color", selector: { text: {} } },
        { name: "continente", selector: { entity: { domain: "sensor", integration: "continente" } } },
        {
          name: "", type: "grid", schema: [
            { name: "group_by_category", selector: { boolean: {} } },
            { name: "show_completed", selector: { boolean: {} } },
            { name: "auto_category", selector: { boolean: {} } },
            { name: "recommendations", selector: { number: { min: 0, max: 20, mode: "box" } } },
          ],
        },
      ],
      computeLabel: (s) => labels[s.name],
    };
  }

  /** Layout de secções: ocupa a largura toda por omissão, mínimo meia coluna. */
  getGridOptions() {
    return { columns: 12, min_columns: 6, min_rows: 4 };
  }

  setConfig(config) {
    if (!config || typeof config.entity !== "string" || !config.entity.startsWith("todo.")) {
      throw new Error("Define uma entidade `todo.` (ex.: todo.lista_de_compras)");
    }
    const prevEntity = this._config && this._config.entity;
    this._config = {
      title: "Compras",
      group_by_category: false,
      show_completed: true,
      recommendations: 8,
      auto_category: true,
      ...config,
    };
    this._groupByCategory = !!this._config.group_by_category;
    this._showCompleted = this._config.show_completed !== false;
    if (prevEntity !== this._config.entity) {
      this._activeCats = new Set();
      this._remoteLoaded = false;
      this._remoteDisabled = false;
      this._remoteRetryAt = 0;
      clearTimeout(this._remoteSaveTimer);
      this._loadCatalog();
      this._loadCats();
      this._loadSeen();
    }
    this._loadPrefs();
    this._buildChrome();
    this._applyAccent();
    this._ensureSubscribed();
    this._renderDynamic();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    this._ensureSubscribed();
    this._checkHealth();
    if (!this._remoteLoaded) this._loadRemoteCatalog();
    // Preços do Continente: só volta a desenhar quando o sensor muda
    const cs = this._contSensor();
    const st = cs ? hass.states[cs] : null;
    if (st !== this._contState) {
      this._contState = st;
      this._contMap = null;
      const typing = this.shadowRoot.activeElement && this.shadowRoot.activeElement.classList.contains("cont-q");
      if (this._loaded) { this._renderList(); this._renderCounts(); if (!typing) this._renderCont(); }
    }
  }

  connectedCallback() {
    document.addEventListener("visibilitychange", this._onVisible);
    this._ensureSubscribed();
    if (this._loaded) { this._syncSeen(); this._renderDynamic(); }
  }

  disconnectedCallback() {
    document.removeEventListener("visibilitychange", this._onVisible);
    this._editing = null;   // o blur nem sempre dispara ao sair da página (Safari/Firefox)
    if (this._drag) this._drag.cancel();
    this._teardown();
  }

  getCardSize() {
    return 6;
  }

  /* ---------------- Data layer ---------------- */

  _ensureSubscribed() {
    if (!this._hass || !this._config || !this.isConnected) return;
    const entity = this._config.entity;
    const active = this._unsub || this._subPending || this._pollTimer;
    if (this._subscribedEntity === entity && active) return;
    this._teardown();
    if (this._subscribedEntity !== entity) {
      this._items = [];
      this._loaded = false;
      this._error = null;
      this._prevStatus = null;
      this._restoring = [];
      this._subscribedEntity = entity;
    }
    this._subscribe();
  }

  async _subscribe() {
    const gen = ++this._subGen;
    const entity_id = this._config.entity;
    this._subPending = true;
    try {
      const unsub = await this._hass.connection.subscribeMessage(
        (msg) => { if (gen === this._subGen) this._onItems(msg && msg.items); },
        { type: "todo/item/subscribe", entity_id }
      );
      if (gen !== this._subGen) { try { unsub(); } catch (_) {} return; }
      this._unsub = unsub;
      this._live = true;
    } catch (e) {
      if (gen !== this._subGen) return;
      // Sem tempo real (HA antigo, entidade ainda a arrancar, ...): lê e vai atualizando.
      this._live = false;
      await this._refresh(gen);
      if (gen === this._subGen) this._startPolling(gen);
    } finally {
      if (gen === this._subGen) this._subPending = false;
    }
  }

  _startPolling(gen) {
    clearInterval(this._pollTimer);
    let ticks = 0;
    this._pollTimer = setInterval(() => {
      if (gen !== this._subGen) return;
      ticks += 1;
      if (ticks % 6 === 0) this._resubscribe();   // de minuto a minuto tenta voltar ao tempo real
      else this._refresh(gen);
    }, 10000);
  }

  async _refresh(gen = this._subGen) {
    if (!this._hass || !this._config) return;
    try {
      const res = await this._hass.callWS({ type: "todo/item/list", entity_id: this._config.entity });
      if (gen !== this._subGen) return;
      this._onItems(res && res.items);
    } catch (e) {
      if (gen !== this._subGen) return;
      if (!this._loaded) { this._error = e; this._renderDynamic(); }
    }
  }

  _resubscribe() {
    this._teardown();
    if (this._loaded) this._syncSeen();   // pode ter havido mudanças vistas noutros dispositivos
    this._ensureSubscribed();
  }

  _teardown() {
    this._subGen += 1;
    this._subPending = false;
    this._live = false;
    clearInterval(this._pollTimer);
    this._pollTimer = null;
    clearTimeout(this._healTimer);
    this._healTimer = null;
    if (this._unsub) {
      try { this._unsub(); } catch (_) {}
      this._unsub = null;
    }
  }

  /**
   * Auto-correção: o estado da entidade todo é o nº de artigos por comprar.
   * Se não bate certo com o que temos (subscrição perdida após reinício do HA,
   * websocket reconectado, ...), volta a subscrever para obter a lista fresca.
   */
  _checkHealth() {
    const st = this._hass && this._hass.states[this._config.entity];
    const available = !!st && st.state !== "unavailable" && st.state !== "unknown";
    const cameBack = available && !this._entityAvailable;
    this._entityAvailable = available;
    if (!this._loaded && !this._error) return;
    if (cameBack) { this._resubscribe(); return; }
    if (!available || this._healTimer) return;
    const expected = parseInt(st.state, 10);
    if (!Number.isFinite(expected) || expected === this._pendingCount()) { this._healedFor = null; return; }
    if (this._healedFor === st.state) return;   // já tentámos para este valor; não insistir
    this._healTimer = setTimeout(() => {
      this._healTimer = null;
      const s = this._hass && this._hass.states[this._config.entity];
      const exp = s ? parseInt(s.state, 10) : NaN;
      if (!Number.isFinite(exp) || exp === this._pendingCount()) return;
      this._healedFor = s.state;
      this._resubscribe();
    }, 2000);
  }

  _pendingCount() {
    return this._items.filter((i) => i.status === "needs_action").length;
  }

  _onItems(items) {
    const list = Array.isArray(items) ? items : [];
    this._learnFromChanges(list);
    this._items = list;
    this._loaded = true;
    this._error = null;
    this._processNew();
    this._learnFromList();
    this._applyRestoreDone();
    this._renderDynamic();
  }

  _supportsDescription() {
    const st = this._hass && this._hass.states[this._config.entity];
    const sf = st && st.attributes ? (st.attributes.supported_features | 0) : 0;
    return (sf & FEAT_SET_DESCRIPTION) === FEAT_SET_DESCRIPTION;
  }

  async _callService(service, data) {
    try {
      await this._hass.callService("todo", service, data, { entity_id: this._config.entity });
    } catch (e) {
      this._toast(`Erro: ${e && e.message ? e.message : e}`);
      this._refresh();
      throw e;
    }
    // Sem tempo real, a lista só muda quando a voltamos a ler.
    if (!this._live) await this._refresh();
  }

  /** Espera (no máx. `ms`) até a lista conter o artigo, para a ação seguinte ver dados frescos. */
  async _waitFor(test, ms = 1500) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (test()) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  }

  _findRaw(uid) {
    return this._items.find((x) => x.uid === uid);
  }

  /** Procura um artigo já existente com o mesmo nome (ignora maiúsculas/acentos). */
  _findByName(name) {
    const key = norm(qtyAndName(name).name || name);
    if (!key) return null;
    const parsed = this._allParsed().filter((i) => norm(i.effName) === key);
    return parsed.find((i) => !i.done) || parsed[0] || null;
  }

  _buildSummary(name, qty, cat) {
    let summary = qty > 1 ? `${qty}x ${name}` : name;
    const data = {};
    if (cat) {
      if (this._supportsDescription()) data.description = cat;
      else summary = `${summary} [${cat}]`;
    }
    data.item = summary;
    return data;
  }

  /**
   * Adiciona um artigo. Se já existir:
   *  - por comprar  -> soma a quantidade
   *  - já comprado  -> volta a pô-lo na lista (em vez de criar um duplicado)
   * Devolve o nome que ficou visível (para mensagens).
   */
  _addItem(rawName, qtyIn, category) {
    // em fila: adições rápidas seguidas veem sempre a lista atualizada (sem duplicados)
    const run = () => this._addItemNow(rawName, qtyIn, category);
    this._addQueue = (this._addQueue || Promise.resolve()).then(run, run);
    return this._addQueue;
  }

  async _addItemNow(rawName, qtyIn, category) {
    const split = qtyAndName(rawName);
    const name = split.name.replace(BRACKET_RE, "").trim();
    if (!name) return null;
    const qtyField = clampQty(qtyIn);
    const qty = split.qty && qtyField === 1 ? split.qty : qtyField;
    let cat = (category || "").trim();
    if (!cat) cat = this._categoryFor(name);
    cat = this._canonicalCat(cat);

    const existing = this._findByName(name);
    this._recordNeed(name, cat || (existing && existing.category) || "");
    if (cat) this._addCat(cat);

    if (existing && !existing.done) {
      await this._updateItem(existing, { name: existing.effName, qty: existing.effQty + qty, category: cat || existing.category });
      this._toast(`“${existing.effName}” já estava na lista · agora ×${clampQty(existing.effQty + qty)}`);
      return existing.effName;
    }
    if (existing && existing.done) {
      await this._updateItem(existing, { name: existing.effName, qty, category: cat || existing.category, status: "needs_action" });
      this._toast(`“${existing.effName}” voltou à lista`);
      return existing.effName;
    }
    const data = this._buildSummary(name, qty, cat);
    markLocal(this._config.entity, data.item);   // não é para "arrumar" como se viesse do Siri
    await this._callService("add_item", data);
    await this._waitFor(() => this._findByName(name));
    return name;
  }

  /** Adiciona vários artigos de uma vez ("leite, pão, 2x ovos"). */
  async _addMany(text, qtyIn, category) {
    const seen = new Set();
    const parts = splitMulti(text).filter((p) => {
      const k = norm(splitQty(p).name);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (!parts.length) return null;
    if (parts.length === 1) return this._addItem(parts[0], qtyIn, category);
    let ok = 0;
    for (const p of parts) {
      try { if (await this._addItem(p, qtyIn, category)) ok += 1; } catch (_) {}
    }
    this._toast(ok === parts.length ? `${ok} artigos adicionados` : `${ok} de ${parts.length} artigos adicionados`);
    this._revealAll();
    return null;
  }

  /** Atualiza nome/quantidade/categoria/estado de um artigo, preservando o resto. */
  _updateItem(it, { qty, category, status, name } = {}) {
    const raw = this._findRaw(it.uid);
    if (!raw) return Promise.resolve();
    const p = this._parse(raw);
    const newName = (name != null ? name : p.name).trim() || p.name;
    const newQty = qty != null ? clampQty(qty) : p.qty;
    const newCat = category != null ? this._canonicalCat(category.trim()) : p.category;
    const data = { item: it.uid };
    const useDesc = this._supportsDescription();
    let summary = newQty > 1 ? `${newQty}x ${newName}` : newName;
    if (newCat && !useDesc) summary = `${summary} [${newCat}]`;
    if (summary !== raw.summary) data.rename = summary;
    if (useDesc && newCat !== (raw.description || "").trim()) data.description = newCat;
    if (status && status !== raw.status) data.status = status;
    if (Object.keys(data).length === 1) return Promise.resolve();
    return this._callService("update_item", data);
  }

  _toggleItem(uid, btn) {
    const raw = this._findRaw(uid);   // usa o estado atual, não o do último render
    if (!raw) return;
    const done = raw.status === "completed";
    // resposta visual imediata; o render seguinte (confirmação ou erro do HA) acerta o estado
    const row = btn && btn.closest(".row");
    if (row) {
      row.classList.toggle("done", !done);
      btn.classList.toggle("done", !done);
      btn.textContent = done ? "" : "✓";
      row.classList.add("pending");
    }
    this._callService("update_item", { item: uid, status: done ? "needs_action" : "completed" }).catch(() => this._renderList());
  }

  _setQty(uid, qty) {
    const raw = this._findRaw(uid);
    if (!raw) return;
    this._updateItem({ uid }, { qty });
  }

  _removeItem(uid, btn) {
    const raw = this._findRaw(uid);
    if (!raw) return;
    const snapshot = { ...raw };
    const row = btn && btn.closest(".row");
    if (row) row.classList.add("removing");
    this._callService("remove_item", { item: uid }).catch(() => this._renderList());
    const p = this._parse(raw);
    this._toast(`“${p.name}” removido`, "Desfazer", () => this._restoreAdd(snapshot));
  }

  _clearCompleted() {
    const done = this._items.filter((i) => i.status === "completed");
    if (!done.length) return;
    const snapshots = done.map((i) => ({ ...i }));
    this._$(".list").querySelectorAll(".row.done").forEach((r) => r.classList.add("removing"));
    this._callService("remove_item", { item: done.map((i) => i.uid) }).catch(() => this._renderList());
    this._toast(`${done.length} comprado${done.length > 1 ? "s" : ""} removido${done.length > 1 ? "s" : ""}`, "Desfazer", async () => {
      for (const s of snapshots) await this._restoreAdd(s);
    });
  }

  /** Artigos por comprar sem categoria para os quais conseguimos adivinhar uma. */
  _autoCatCandidates() {
    if (this._config.auto_category === false) return [];
    return this._allParsed()
      .filter((i) => !i.done && !i.category)
      .map((i) => ({ it: i, cat: this._categoryFor(i.name) }))
      .filter((x) => x.cat);
  }

  async _autoCategorizeAll() {
    const list = this._autoCatCandidates();
    let ok = 0;
    for (const { it, cat } of list) {
      try { this._addCat(cat); await this._updateItem(it, { category: cat }); ok += 1; } catch (_) {}
    }
    if (ok) this._toast(`${ok} artigo${ok > 1 ? "s" : ""} categorizado${ok > 1 ? "s" : ""}`);
  }

  /** Volta a criar um artigo removido (Desfazer). Não conta como novo pedido. */
  async _restoreAdd(snapshot) {
    const entry = { summary: snapshot.summary, done: snapshot.status === "completed", expires: Date.now() + 20000, uid: null };
    this._restoring.push(entry);
    const data = { item: snapshot.summary };
    if (snapshot.description) data.description = snapshot.description;
    markLocal(this._config.entity, snapshot.summary);
    try {
      await this._callService("add_item", data);
    } catch (_) {
      this._restoring = this._restoring.filter((r) => r !== entry);
    }
  }

  /** Depois de "Desfazer", artigos que estavam comprados voltam a ficar comprados. */
  _applyRestoreDone() {
    for (const r of this._restoring) {
      if (!r.uid || r.handled) continue;
      r.handled = true;
      if (r.done) this._callService("update_item", { item: r.uid, status: "completed" }).catch(() => {});
    }
    this._restoring = this._restoring.filter((r) => !r.handled && r.expires > Date.now());
  }

  /** Mostra tudo (limpa pesquisa e filtros) — usado quando algo novo ficaria escondido. */
  _revealAll() {
    const searchInput = this.shadowRoot.querySelector(".search-input");
    const changed = this._search || this._activeCats.size;
    this._search = "";
    if (searchInput) searchInput.value = "";
    const clear = this.shadowRoot.querySelector(".search-clear");
    if (clear) clear.style.display = "none";
    this._activeCats.clear();
    this._savePrefs();
    if (changed) this._renderDynamic();
  }

  /* ---------------- Parsing + filtros ---------------- */

  _parse(item) {
    const summary = item.summary || "";
    let qty = 1;
    let rest = summary;
    const qm = summary.match(QTY_RE);
    if (qm) { qty = clampQty(qm[1]); rest = summary.slice(qm[0].length); }

    let category = (item.description || "").trim();
    if (!category) {
      const bm = rest.match(BRACKET_RE);
      if (bm) category = bm[1].trim();
    }
    if (!category) {
      const tm = rest.match(/#([\p{L}\p{N}_-]+)/u); // legado
      if (tm) category = tm[1];
    }

    const name = rest
      .replace(BRACKET_RE, "")
      .replace(TAG_RE, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    // nome/quantidade "efetivos", para comparar com o que vem por voz ("Dois ovos." == "2x ovos")
    const eff = qtyAndName((qm ? qm[0] : "") + name);

    return {
      uid: item.uid,
      summary,
      name: name || rest.trim() || summary || "(sem nome)",
      category,
      catKey: norm(category),
      qty,
      effName: eff.name || name,
      effQty: eff.qty || 1,
      status: item.status,
      done: item.status === "completed",
    };
  }

  _allParsed() {
    if (this._parsedFor !== this._items) {
      this._parsedFor = this._items;
      this._parsedCache = this._items.map((i) => this._parse(i));
    }
    return this._parsedCache;
  }

  /** Categorias presentes na lista, sem duplicados por maiúsculas/acentos. */
  _itemCats() {
    const map = new Map();
    for (const it of this._allParsed()) if (it.category && !map.has(it.catKey)) map.set(it.catKey, it.category);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt"));
  }

  _matchesSearch(it) {
    if (!this._search) return true;
    const q = norm(this._search);
    return norm(it.name).includes(q) || (it.catKey && it.catKey.includes(q));
  }

  _matchesCats(it) {
    if (this._activeCats.size === 0) return true;
    if (!it.category) return this._activeCats.has(UNCAT);
    return this._activeCats.has(it.catKey);
  }

  _matchesFilters(it) {
    if (!this._showCompleted && it.done) return false;
    return this._matchesSearch(it) && this._matchesCats(it);
  }

  /* ---------------- Categorias ---------------- */

  _addCat(name) {
    const n = (name || "").trim();
    if (!n) return;
    if (![...this._cats].some((c) => norm(c) === norm(n))) {
      this._cats.add(n);
      this._saveCats();
    }
  }

  /** Invalida as caches que dependem do catálogo/categorias. */
  _bumpCats() { this._catsVer = (this._catsVer || 0) + 1; }

  _knownCats() {
    const c = this._knownCache;
    if (c && c.items === this._items && c.ver === this._catsVer) return c.list;
    const list = this._computeKnownCats();
    this._knownCache = { items: this._items, ver: this._catsVer, list };
    return list;
  }

  _computeKnownCats() {
    const map = new Map(); // norm -> display
    const add = (c) => {
      const n = (c || "").trim();
      if (n && !map.has(norm(n))) map.set(norm(n), n);
    };
    this._allParsed().forEach((it) => add(it.category));
    this._cats.forEach(add);
    Object.values(this._catalog).forEach((c) => add(c.category));
    return [...map.values()].sort((a, b) => a.localeCompare(b, "pt"));
  }

  /** Usa a grafia de uma categoria já existente ("fruta" -> "Fruta"). */
  _canonicalCat(cat) {
    const n = (cat || "").trim();
    if (!n) return "";
    const key = norm(n);
    return this._knownCats().find((c) => norm(c) === key) || n;
  }

  /** Categoria provável para um nome: histórico primeiro, depois o dicionário. */
  _categoryFor(name) {
    const entry = this._catalog[norm(name)];
    if (entry && entry.category) return entry.category;
    const inList = this._findByName(name);
    if (inList && inList.category) return inList.category;
    if (this._config.auto_category === false) return "";
    return this._mapToUserCat(guessCategory(name));
  }

  /** "Frutas e Legumes" -> "Fruta" se o utilizador já usa uma categoria parecida. */
  _mapToUserCat(guess) {
    if (!guess) return "";
    const stem = (c) => norm(c).split(" ")[0].replace(/s$/, "");
    const g = stem(guess);
    return this._knownCats().find((c) => norm(c) === norm(guess))
      || this._knownCats().find((c) => stem(c) === g)
      || guess;
  }

  _computeCatOptions(text) {
    const raw = (text || "").trim();
    const q = norm(raw);
    const all = this._knownCats();
    const filtered = q ? all.filter((c) => norm(c).includes(q)) : all;
    const out = filtered.map((c) => ({ name: c, create: false }));
    if (q && !all.some((c) => norm(c) === q)) out.unshift({ name: raw, create: true });
    if (!q) for (const c of Object.keys(AUTO_CATS)) {
      if (!all.some((k) => norm(k) === norm(c))) out.push({ name: c, create: false, preset: true });
    }
    return out.slice(0, 30);
  }

  /* ---------------- Histórico (catálogo) ---------------- */

  _catalogKey() { return `slpc-catalog:${this._config.entity}`; }
  _catsKey() { return `slpc-cats:${this._config.entity}`; }
  _remoteKey() { return `slpc-${this._config.entity}`; }

  _loadCatalog() {
    let raw = {};
    try {
      const r = window.localStorage.getItem(this._catalogKey());
      raw = r ? JSON.parse(r) : {};
    } catch (_) { raw = {}; }
    this._catalog = {};
    this._mergeCatalog(raw && typeof raw === "object" ? raw : {});
  }

  _saveCatalog() {
    this._bumpCats();
    this._pruneCatalog();
    try { window.localStorage.setItem(this._catalogKey(), JSON.stringify(this._catalog)); } catch (_) {}
    this._scheduleRemoteSave();
  }

  _loadCats() {
    try {
      const r = window.localStorage.getItem(this._catsKey());
      const a = r ? JSON.parse(r) : [];
      this._cats = new Set(Array.isArray(a) ? a.filter((x) => typeof x === "string") : []);
    } catch (_) { this._cats = new Set(); }
    this._bumpCats();
  }

  _saveCats() {
    this._bumpCats();
    try { window.localStorage.setItem(this._catsKey(), JSON.stringify([...this._cats])); } catch (_) {}
    this._scheduleRemoteSave();
  }

  /** Junta entradas (locais antigas, remotas) sem perder histórico. Chaves sempre normalizadas. */
  _mergeCatalog(src) {
    this._bumpCats();
    for (const [k, v] of Object.entries(src || {})) {
      if (!v || typeof v !== "object" || typeof v.name !== "string") continue;
      const key = norm(splitQty(v.name).name) || norm(k);
      if (!key) continue;
      const cur = this._catalog[key];
      const hist = [...((cur && cur.hist) || []), ...(Array.isArray(v.hist) ? v.hist : [])]
        .filter((t) => typeof t === "number" && t > 0);
      if (!hist.length && v.last > 0) hist.push(v.last);   // formato antigo (v1.2)
      const merged = {
        name: (cur && cur.name) || splitQty(v.name).name || v.name,
        category: (cur && cur.category) || v.category || "",
        hist: this._dedupeHist(hist),
        with: { ...((cur && cur.with) || {}) },
        snooze: Math.max((cur && cur.snooze) || 0, v.snooze || 0),
      };
      for (const [o, n] of Object.entries(v.with || {})) merged.with[o] = Math.max(merged.with[o] || 0, n | 0);
      merged.count = Math.max((cur && cur.count) || 0, v.count | 0, merged.hist.length);
      merged.last = merged.hist.length ? merged.hist[merged.hist.length - 1] : 0;
      this._catalog[key] = merged;
    }
  }

  /** Ordena e junta registos com menos de 10 min (o mesmo pedido visto por vários dispositivos). */
  _dedupeHist(hist) {
    const out = [];
    for (const t of [...hist].sort((a, b) => a - b)) {
      if (!out.length || t - out[out.length - 1] > 600000) out.push(t);
    }
    return out.slice(-HISTORY_LEN);
  }

  _pruneCatalog() {
    const all = Object.keys(this._catalog);
    if (all.length <= 400) return;
    const now = Date.now();
    const keep = new Set(this._allParsed().map((i) => norm(i.effName)));
    const keys = all.filter((k) => !keep.has(k) && !(this._catalog[k].snooze > now));
    const act = (e) => Math.max(e.last || 0, e.snooze || 0);
    keys.sort((a, b) => (this._catalog[a].count - this._catalog[b].count) || (act(this._catalog[a]) - act(this._catalog[b])));
    for (const k of keys.slice(0, all.length - 400)) delete this._catalog[k];
  }

  /** Lê o histórico guardado no HA (dados do utilizador) — sincroniza entre dispositivos. */
  async _loadRemoteCatalog() {
    if (!this._hass || !this._hass.callWS || this._remoteLoading || this._remoteDisabled) return;
    if (Date.now() < (this._remoteRetryAt || 0)) return;
    this._remoteLoading = true;
    const entity = this._config.entity;
    try {
      const res = await this._hass.callWS({ type: "frontend/get_user_data", key: this._remoteKey() });
      if (entity !== this._config.entity) return;
      this._applyRemote(res && res.value);
      this._remoteLoaded = true;
      this._saveCatalog();
      this._renderRecs();
    } catch (e) {
      if (e && e.code === "unknown_command") this._remoteDisabled = true;   // HA sem suporte: fica só no browser
      else this._remoteRetryAt = Date.now() + 60000;                     // falha temporária: tenta mais tarde
    } finally {
      this._remoteLoading = false;
      if (entity === this._config.entity) this._processNew();
    }
  }

  /**
   * Guarda os uids mais recentes (limite de tamanho). Não se corta pelos artigos atuais:
   * a lista local pode ainda não ter chegado e perderíamos o que outros dispositivos já viram.
   */
  _seenForSave() {
    if (!this._seen) return undefined;
    const all = [...this._seen];
    return all.length > 1000 ? all.slice(-1000) : all;
  }

  _applyRemote(v) {
    if (!v || typeof v !== "object") return;
    this._mergeCatalog(v.catalog || {});
    if (Array.isArray(v.seen)) this._seen = new Set([...(this._seen || []), ...v.seen]);
    (Array.isArray(v.cats) ? v.cats : []).forEach((c) => typeof c === "string" && this._addCat(c));
  }

  /** Grava no HA depois de juntar com o que lá estiver (outro dispositivo pode ter gravado entretanto). */
  _scheduleRemoteSave() {
    if (!this._remoteLoaded || this._remoteDisabled || !this._hass) return;
    clearTimeout(this._remoteSaveTimer);
    const entity = this._config.entity;
    const key = this._remoteKey();
    this._remoteSaveTimer = setTimeout(async () => {
      if (entity !== this._config.entity || !this._hass) return;
      try {
        const res = await this._hass.callWS({ type: "frontend/get_user_data", key });
        if (entity !== this._config.entity) return;
        this._applyRemote(res && res.value);
        this._pruneCatalog();
        try { window.localStorage.setItem(this._catalogKey(), JSON.stringify(this._catalog)); } catch (_) {}
        await this._hass.callWS({
          type: "frontend/set_user_data",
          key,
          value: { v: 1, catalog: this._catalog, cats: [...this._cats], seen: this._seenForSave() },
        });
      } catch (e) {
        if (e && e.code === "unknown_command") this._remoteDisabled = true;
        // outras falhas: fica para a próxima alteração
      }
    }, 2500);
  }

  /* ---------------- Aprendizagem ---------------- */

  /** Regista que o artigo foi pedido agora (adicionado à lista, venha de onde vier). */
  _recordNeed(name, category, when = Date.now()) {
    const clean = splitQty(name).name;
    const key = norm(clean);
    if (!key) return;
    const e = this._catalog[key] || { name: clean, category: "", hist: [], with: {}, count: 0, last: 0, snooze: 0 };
    if (category) e.category = category;
    const recent = e.hist.length && when - e.hist[e.hist.length - 1] < 600000;
    if (!recent) {
      // co-ocorrência: o que foi pedido na mesma ida às compras
      for (const [k, o] of Object.entries(this._catalog)) {
        if (k === key || !o.last || Math.abs(when - o.last) > SESSION_GAP) continue;
        e.with[k] = (e.with[k] || 0) + 1;
        o.with = o.with || {};
        o.with[key] = (o.with[key] || 0) + 1;
        this._trimWith(o);
      }
      this._trimWith(e);
      e.hist = this._dedupeHist([...e.hist, when]);
      e.count = (e.count || 0) + 1;
      e.last = when;
    }
    e.snooze = 0;
    this._catalog[key] = e;
    this._saveCatalog();
  }

  _trimWith(e) {
    const ent = Object.entries(e.with || {});
    if (ent.length <= 25) return;
    e.with = Object.fromEntries(ent.sort((a, b) => b[1] - a[1]).slice(0, 25));
  }

  /** Artigos que voltaram de "comprado" para "por comprar" contam como novo pedido. */
  _learnFromChanges(list) {
    const prev = this._prevStatus;
    this._prevStatus = new Map(list.map((i) => [i.uid, i.status]));
    if (!prev) return;
    for (const raw of list) {
      if (prev.get(raw.uid) === "completed" && raw.status === "needs_action") {
        const p = this._parse(raw);
        this._recordNeed(p.name, p.category);
      }
    }
  }

  /* --- artigos novos, mesmo os adicionados com o card fechado (Siri, app, outro dispositivo) --- */

  _seenKey() { return `slpc-seen:${this._config.entity}`; }

  _loadSeen() {
    try {
      const r = window.localStorage.getItem(this._seenKey());
      const a = r ? JSON.parse(r) : null;
      this._seen = Array.isArray(a) ? new Set(a) : null;   // null = nunca correu neste browser
    } catch (_) { this._seen = null; }
  }

  _saveSeen() {
    try { window.localStorage.setItem(this._seenKey(), JSON.stringify(this._seenForSave() || [])); } catch (_) {}
    this._scheduleRemoteSave();
  }

  /** Só depois de tentar ler os dados do HA (que trazem o que os outros dispositivos já viram). */
  _seenReady() {
    return !this._seenStale && (this._remoteLoaded || this._remoteDisabled || this._remoteRetryAt > 0);
  }

  /** Card aberto há muito (tablet, separador em fundo): antes de processar, lê o que os outros já viram. */
  async _syncSeen() {
    if (this._remoteDisabled || !this._remoteLoaded || !this._hass || this._seenSyncing) return;
    this._seenSyncing = true;
    this._seenStale = true;
    const entity = this._config.entity;
    try {
      const res = await this._hass.callWS({ type: "frontend/get_user_data", key: this._remoteKey() });
      if (entity === this._config.entity) this._applyRemote(res && res.value);
    } catch (_) { /* segue com o que temos */ }
    finally {
      this._seenSyncing = false;
      this._seenStale = false;
      if (entity === this._config.entity) this._processNew();
    }
  }

  _processNew() {
    if (!this._loaded || !this._seenReady()) return;
    const firstRun = !this._seen;
    const seen = this._seen || new Set();
    const fresh = this._items.filter((i) => !seen.has(i.uid));
    this._seen = new Set([...seen, ...this._items.map((i) => i.uid)]);
    if (!fresh.length && !firstRun) return;
    this._saveSeen();
    if (firstRun) return;   // primeira vez: o que já lá estava não é "novo"
    const now = Date.now();
    for (const raw of fresh) {
      const r = this._restoring.find((x) => !x.uid && x.summary === raw.summary && x.expires > now);
      if (r) { r.uid = raw.uid; continue; }                     // reposto por "Desfazer"
      if (RECENT_LOCAL.get(`${this._config.entity}|${raw.summary}`) > now) continue;   // veio de um card aqui
      if (raw.status !== "needs_action") continue;
      const p = this._parse(raw);
      this._recordNeed(p.effName, p.category);
      if (p.category) continue;   // já tem categoria: foi um card (de outra pessoa/dispositivo); não mexer
      this._tidying = this._tidying || new Set();
      this._tidying.add(raw.uid);
      const run = () => this._tidyNew(raw.uid).finally(() => this._tidying.delete(raw.uid));
      this._addQueue = (this._addQueue || Promise.resolve()).then(run, run);   // um de cada vez
    }
  }

  /**
   * Arruma um artigo que chegou de fora (ex.: "Dois ovos." ditado ao Siri):
   * quantidade por extenso -> "2x", tira a pontuação, junta a um igual que já exista
   * e adivinha a categoria. Corre em fila e relê sempre o estado atual.
   */
  async _tidyNew(uid) {
    const raw = this._findRaw(uid);
    if (!raw || raw.status !== "needs_action") return;
    const p = this._parse(raw);
    const key = norm(p.effName);
    const same = this._allParsed().filter((i) => i.uid !== uid && !this._tidying.has(i.uid) && norm(i.effName) === key);
    const dup = same.find((i) => !i.done) || same[0];
    const target = { entity_id: this._config.entity };
    if (dup) {
      try {
        // remover primeiro: se outro dispositivo já o fez, falha e não somamos duas vezes
        await this._hass.callService("todo", "remove_item", { item: uid }, target);
      } catch (_) { return; }
      const cur = this._findRaw(dup.uid) ? this._parse(this._findRaw(dup.uid)) : dup;
      const qty = cur.done ? p.effQty : cur.effQty + p.effQty;
      try {
        await this._updateItem(cur, { name: cur.effName, qty, status: cur.done ? "needs_action" : undefined });
        this._toast(cur.done ? `“${cur.effName}” voltou à lista` : `“${cur.effName}” já estava na lista · agora ×${clampQty(qty)}`);
        await this._waitFor(() => !this._findRaw(uid));
      } catch (_) {
        // não conseguimos somar: repõe o artigo para não se perder
        markLocal(this._config.entity, raw.summary);
        this._hass.callService("todo", "add_item", { item: raw.summary }, target).catch(() => {});
      }
      return;
    }
    const category = this._config.auto_category === false ? "" : this._categoryFor(p.effName);
    if (p.effName === p.name && p.effQty === p.qty && !category) return;
    if (category) this._addCat(category);
    await this._updateItem({ uid }, { name: p.effName, qty: p.effQty, category }).catch(() => {});
    await this._waitFor(() => { const r = this._findRaw(uid); return !r || r.summary !== raw.summary || (r.description || "") !== (raw.description || ""); });
  }

  /** Garante que tudo o que está na lista existe no catálogo (sem contar como compra). */
  _learnFromList() {
    let changed = false;
    let catsChanged = false;
    for (const it of this._allParsed()) {
      const name = it.effName;   // "Dois ovos." -> "ovos"
      const key = norm(name);
      if (!key) continue;
      const e = this._catalog[key];
      if (!e) {
        this._catalog[key] = { name, category: it.category || "", hist: [], with: {}, count: 0, last: 0, snooze: 0 };
        changed = true;
      } else if ((it.category && e.category !== it.category) || (!e.count && e.name !== name)) {
        if (it.category) e.category = it.category;
        if (!e.count) e.name = name;
        changed = true;
      }
      if (it.category && ![...this._cats].some((c) => norm(c) === it.catKey)) { this._cats.add(it.category); catsChanged = true; }
    }
    if (catsChanged) this._saveCats();
    if (changed) this._saveCatalog();
  }

  /* ---------------- Recomendações ---------------- */

  /**
   * Pontua artigos do histórico que não estão por comprar:
   *  - "está na altura": tempo desde o último pedido vs. intervalo habitual
   *  - frequência
   *  - costuma vir junto com o que já está na lista
   */
  _computeRecs(limit) {
    const now = Date.now();
    const parsed = this._allParsed();
    const pending = new Set(parsed.filter((i) => !i.done).map((i) => norm(i.effName)));
    const out = [];
    for (const [key, e] of Object.entries(this._catalog)) {
      if (pending.has(key) || !e.count || (e.snooze && e.snooze > now)) continue;
      const hist = e.hist || [];
      let score = Math.log2(1 + e.count);
      let reason = e.count >= 3 ? `pedido ${e.count} vezes` : "já compraste";
      let interval = 0;
      if (hist.length >= 2) {
        const diffs = hist.slice(1).map((t, i) => t - hist[i]).sort((a, b) => a - b);
        interval = Math.max(DAY, diffs[Math.floor(diffs.length / 2)]);
        const due = (now - e.last) / interval;
        if (due < 0.5) score *= 0.25;                        // comprado há pouco
        else score += Math.min(due, 3) * 2;
        if (due >= 0.9) reason = `costumas pedir a cada ~${Math.max(1, Math.round(interval / DAY))} dias`;
      } else if (now - e.last < 2 * DAY) {
        score *= 0.4;
      }
      let co = 0;
      let coName = "";
      for (const p of pending) {
        const n = (e.with && e.with[p]) || 0;
        if (n > co) { co = n; coName = (this._catalog[p] && this._catalog[p].name) || p; }
      }
      if (co >= 2) {
        score += Math.min(co / e.count, 1) * 2.5;
        if (!(interval && (now - e.last) / interval >= 0.9)) reason = `costuma ir com ${coName}`;
      }
      out.push({ key, name: e.name, category: e.category || "", score, reason });
    }
    out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "pt"));
    const recs = out.slice(0, limit);
    // arranque a frio: completa com básicos
    const history = Object.entries(this._catalog).filter(([k, e]) => e.count > 0 && !pending.has(k)).length;
    if (recs.length < limit && history < 6) {
      for (const [name, cat] of STAPLES) {
        if (recs.length >= limit) break;
        const key = norm(name);
        const e = this._catalog[key];
        if (pending.has(key) || recs.some((r) => r.key === key) || (e && e.snooze > now)) continue;
        recs.push({ key, name, category: this._mapToUserCat(cat), score: 0, reason: "básico", staple: true });
      }
    }
    return recs;
  }

  _snooze(key) {
    const now = Date.now();
    const rec = (this._recs || []).find((r) => r.key === key);
    const e = this._catalog[key] || { name: rec ? rec.name : key, category: rec ? rec.category : "", hist: [], with: {}, count: 0, last: 0 };
    const hist = e.hist || [];
    let span = 7 * DAY;
    if (hist.length >= 2) span = Math.max(span, (hist[hist.length - 1] - hist[0]) / (hist.length - 1));
    e.snooze = now + span;
    this._catalog[key] = e;
    this._saveCatalog();
    this._renderRecs();
  }

  /** Sugestões enquanto se escreve o nome: artigos da lista + histórico + dicionário. */
  _computeSuggestions(text) {
    const q = norm(splitQty(text).name);
    if (!q) return [];
    const rank = (n) => (n.startsWith(q) ? 0 : n.split(" ").some((w) => w.startsWith(q)) ? 1 : n.includes(q) ? 2 : -1);
    const out = [];
    const seen = new Set();
    for (const it of this._allParsed()) {
      const n = norm(it.name);
      const r = rank(n);
      if (r < 0 || seen.has(n)) continue;
      seen.add(n);
      out.push({ kind: it.done ? "done" : "list", r, name: it.name, category: it.category, qty: it.qty, uid: it.uid, count: 99 });
    }
    for (const [key, e] of Object.entries(this._catalog)) {
      const r = rank(key);
      if (r < 0 || seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: "catalog", r, name: e.name, category: e.category || "", count: e.count || 0, last: e.last || 0 });
    }
    out.sort((a, b) => a.r - b.r || (a.kind === "list" ? -1 : 0) - (b.kind === "list" ? -1 : 0) || b.count - a.count || (b.last || 0) - (a.last || 0));
    return out.slice(0, 7);
  }

  /* ---------------- Preferências ---------------- */

  _prefsKey() { return `slpc:${this._config.entity}`; }

  _loadPrefs() {
    try {
      const raw = window.localStorage.getItem(this._prefsKey());
      if (!raw) return;
      const p = JSON.parse(raw);
      if (Array.isArray(p.activeCats)) this._activeCats = new Set(p.activeCats.map((c) => (c === UNCAT ? c : norm(c))));
      if (typeof p.group === "boolean") this._groupByCategory = p.group;
      if (typeof p.showCompleted === "boolean") this._showCompleted = p.showCompleted;
    } catch (_) {}
  }

  _savePrefs() {
    try {
      window.localStorage.setItem(this._prefsKey(), JSON.stringify({
        activeCats: [...this._activeCats],
        group: this._groupByCategory,
        showCompleted: this._showCompleted,
      }));
    } catch (_) {}
  }

  /* ---------------- Static chrome ---------------- */

  _applyAccent() {
    const accent = this._config.accent_color;
    if (accent) this.style.setProperty("--slpc-accent", accent);
    else this.style.removeProperty("--slpc-accent");
  }

  _styles() {
    return `
      :host { --slpc-accent: var(--primary-color); --slpc-radius: 12px; display: block; }
      ha-card { display: block; padding: 16px; position: relative; overflow: visible; container-type: inline-size; }
      button { font-family: inherit; }
      button:focus-visible { outline: 2px solid var(--slpc-accent); outline-offset: 2px; }
      .header { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; column-gap: 12px; row-gap: 2px; margin-bottom: 14px; }
      .title { font-size: 1.3rem; font-weight: 600; color: var(--primary-text-color); letter-spacing: -0.01em; }
      .counts { font-size: 0.8rem; color: var(--secondary-text-color); min-width: 0; margin-left: auto; text-align: right; }
      .counts .seg { white-space: nowrap; }
      .counts b { color: var(--slpc-accent); }
      .live-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-left: 6px; vertical-align: middle; background: var(--warning-color, #ffa600); }

      .add-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: stretch; margin-bottom: 10px; }
      .field {
        background: var(--secondary-background-color, rgba(127,127,127,0.1));
        border: 1px solid var(--divider-color, rgba(127,127,127,0.2));
        color: var(--primary-text-color);
        border-radius: var(--slpc-radius); padding: 10px 14px; font-size: 16px;
        outline: none; transition: border-color 0.15s; font-family: inherit; min-width: 0;
      }
      .field:focus { border-color: var(--slpc-accent); }
      .field::placeholder { color: var(--secondary-text-color); opacity: 0.8; }
      .combo { position: relative; }
      .name-wrap { flex: 1 1 100%; }
      .cat-wrap { flex: 1 1 70px; }
      .add-input, .cat-input { width: 100%; box-sizing: border-box; }
      .cat-input.auto { font-style: italic; color: var(--secondary-text-color); }
      .qty-box { display: flex; align-items: center; flex: 0 0 auto; border: 1px solid var(--divider-color, rgba(127,127,127,0.2)); border-radius: var(--slpc-radius); background: var(--secondary-background-color, rgba(127,127,127,0.1)); }
      .qty-box button { border: none; background: none; color: var(--secondary-text-color); width: 32px; height: 100%; min-height: 42px; font-size: 1.1rem; cursor: pointer; }
      .qty-box button:hover { color: var(--slpc-accent); }
      .qty-input { width: 34px; border: none; background: none; text-align: center; padding: 0; border-radius: 0; -moz-appearance: textfield; }
      .qty-input::-webkit-outer-spin-button, .qty-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
      .add-btn {
        flex: 0 0 auto; border: none; cursor: pointer; min-height: 42px;
        background: var(--slpc-accent); color: var(--text-primary-color, #fff);
        border-radius: var(--slpc-radius); padding: 0 14px; font-size: 0.95rem; font-weight: 600;
      }
      .add-btn:active { transform: translateY(1px); }
      .hint { font-size: 0.72rem; color: var(--secondary-text-color); margin: -4px 4px 10px; min-height: 1em; }

      .dropdown {
        position: absolute; left: 0; right: 0; top: calc(100% + 6px); z-index: 40;
        max-height: 280px; overflow: auto; display: none;
        border: 1px solid var(--divider-color, rgba(127,127,127,0.25));
        border-radius: var(--slpc-radius);
        background: var(--card-background-color, var(--ha-card-background, var(--primary-background-color, #fff)));
        box-shadow: 0 12px 28px rgba(0,0,0,0.35);
      }
      .opt { display: flex; align-items: center; gap: 8px; padding: 11px 12px; cursor: pointer; }
      .opt:hover, .opt.hi { background: var(--secondary-background-color, rgba(127,127,127,0.12)); }
      .opt-name { color: var(--primary-text-color); font-size: 0.95rem; }
      .opt-meta { margin-left: auto; font-size: 0.72rem; color: var(--secondary-text-color); white-space: nowrap; }
      .opt.create .opt-name { color: var(--slpc-accent); }
      .opt.preset .opt-name { color: var(--secondary-text-color); }

      .recs { margin-bottom: 12px; }
      .recs-label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--secondary-text-color); margin: 0 4px 6px; }
      .recs-row { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; scrollbar-width: thin; }
      .rec {
        display: inline-flex; align-items: center; flex: 0 0 auto; gap: 2px;
        border: 1px dashed var(--slpc-accent); border-radius: 999px; background: transparent;
        color: var(--primary-text-color); font-size: 0.85rem; padding: 0 4px 0 0; min-height: 32px;
      }
      .rec:hover { background: color-mix(in srgb, var(--slpc-accent) 14%, transparent); }
      .rec.pending { opacity: 0.5; }
      .rec-add { border: none; background: none; color: inherit; font: inherit; cursor: pointer; padding: 6px 2px 6px 10px; display: inline-flex; align-items: center; }
      .rec .plus { color: var(--slpc-accent); font-weight: 700; margin-right: 2px; }
      .rec .x { border: none; background: none; color: var(--secondary-text-color); cursor: pointer; font-size: 0.95rem; padding: 4px 6px; border-radius: 50%; }
      .rec .x:hover { color: var(--error-color, #db4437); }

      .search-wrap { position: relative; margin-bottom: 10px; }
      .search-input { width: 100%; box-sizing: border-box; padding-right: 40px; }
      .search-clear { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); border: none; background: none; color: var(--secondary-text-color); font-size: 1.1rem; cursor: pointer; padding: 6px 10px; display: none; }
      .toolbar { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
      .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
      .chips:empty { display: none; }
      .chip, .toggle {
        cursor: pointer; user-select: none; font-size: 0.8rem;
        border: 1px solid var(--divider-color, rgba(127,127,127,0.3));
        background: transparent; color: var(--secondary-text-color);
        border-radius: 999px; padding: 6px 12px; transition: all 0.12s; min-height: 32px;
      }
      .toggle { border-radius: 8px; }
      .chip:hover, .toggle:hover { border-color: var(--slpc-accent); }
      .chip.active { background: var(--slpc-accent); border-color: var(--slpc-accent); color: var(--text-primary-color, #fff); }
      .toggle.active { color: var(--slpc-accent); border-color: var(--slpc-accent); }
      .toggle.clear-done { margin-left: auto; }
      .toggle[hidden] { display: none; }
      .chip .n { opacity: 0.7; margin-left: 4px; font-size: 0.72rem; }

      .banner {
        display: none; align-items: center; justify-content: space-between; gap: 8px;
        font-size: 0.82rem; color: var(--primary-text-color); margin-bottom: 10px;
        padding: 8px 12px; border-radius: 10px;
        background: color-mix(in srgb, var(--slpc-accent) 14%, transparent);
      }
      .banner button { border: none; background: none; color: var(--slpc-accent); font-weight: 600; cursor: pointer; font-size: 0.82rem; padding: 4px; }

      .group-label {
        font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em;
        color: var(--secondary-text-color); margin: 14px 4px 6px; display: flex; justify-content: space-between;
        border-bottom: 1px solid var(--divider-color, rgba(127,127,127,0.15)); padding-bottom: 4px;
      }
      .done-label { margin-top: 18px; }
      .price {
        flex: 0 0 auto; border: 1px solid var(--divider-color, rgba(127,127,127,0.25)); background: transparent;
        color: var(--secondary-text-color); border-radius: 999px; padding: 2px 8px; font-size: 0.78rem;
        cursor: pointer; font-variant-numeric: tabular-nums; white-space: nowrap;
      }
      .price:hover { border-color: var(--slpc-accent); color: var(--slpc-accent); }
      .price.chosen { border-color: color-mix(in srgb, var(--slpc-accent) 55%, transparent); }
      .price.off { text-decoration: line-through; opacity: 0.7; }
      .price.missing, .price.pending { border-style: dashed; }
      .cont-panel {
        border: 1px solid var(--divider-color, rgba(127,127,127,0.25)); border-radius: var(--slpc-radius);
        padding: 12px; margin: 4px 0 12px; display: flex; flex-direction: column; gap: 6px;
      }
      .cont-panel.busy { opacity: 0.6; pointer-events: none; }
      .cont-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--primary-text-color); }
      .cont-x { border: none; background: none; color: var(--secondary-text-color); font-size: 1.3rem; cursor: pointer; line-height: 1; padding: 4px 8px; }
      .cont-sub { font-size: 0.78rem; color: var(--secondary-text-color); }
      .cont-sub a { color: var(--slpc-accent); }
      .cont-ok { color: var(--success-color, #2e7d32); font-weight: 600; }
      .cont-prod {
        display: flex; justify-content: space-between; gap: 10px; text-align: left; width: 100%;
        border: 1px solid var(--divider-color, rgba(127,127,127,0.25)); background: transparent; color: var(--primary-text-color);
        border-radius: 8px; padding: 8px 10px; font-size: 0.88rem; cursor: pointer;
      }
      .cont-prod:hover { border-color: var(--slpc-accent); }
      .cont-prod.current { border-color: var(--slpc-accent); background: color-mix(in srgb, var(--slpc-accent) 10%, transparent); cursor: default; }
      .cont-prod.off { opacity: 0.6; }
      .cp-price, .cl-price { font-variant-numeric: tabular-nums; white-space: nowrap; }
      .cont-search { display: flex; gap: 6px; margin-top: 4px; }
      .cont-search .field { flex: 1 1 auto; padding: 8px 12px; }
      .cont-foot { display: flex; gap: 6px; flex-wrap: wrap; }
      .cont-lines { display: flex; flex-direction: column; max-height: 50vh; overflow-y: auto; }
      .cont-line {
        display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 2px 8px; align-items: center;
        padding: 6px 0; border-bottom: 1px solid var(--divider-color, rgba(127,127,127,0.15)); font-size: 0.88rem;
      }
      .cl-item { color: var(--primary-text-color); }
      .cl-prod { grid-column: 1; font-size: 0.75rem; color: var(--secondary-text-color); }
      .cl-price { grid-row: 1; grid-column: 2; }
      .cl-swap { grid-row: 1 / span 2; grid-column: 3; border: none; background: none; color: var(--slpc-accent); cursor: pointer; font-size: 0.8rem; padding: 4px; }
      .cont-line.missing .cl-prod, .cont-line.off .cl-prod { color: var(--warning-color, #b26a00); }
      .cont-total { display: flex; justify-content: space-between; padding-top: 4px; color: var(--primary-text-color); }
      .cont-send { align-self: stretch; }
      .cont-send[disabled] { opacity: 0.5; cursor: default; }
      .row { display: flex; align-items: center; gap: 8px; padding: 6px 4px; border-radius: 8px; min-height: 40px; }
      .row:hover { background: var(--secondary-background-color, rgba(127,127,127,0.07)); }
      .check {
        flex: 0 0 auto; width: 26px; height: 26px; border-radius: 7px; cursor: pointer; padding: 0;
        border: 2px solid var(--divider-color, rgba(127,127,127,0.5)); background: transparent;
        display: flex; align-items: center; justify-content: center;
        color: var(--text-primary-color, #fff); font-size: 15px; line-height: 1; transition: all 0.12s;
      }
      .check:hover { border-color: var(--slpc-accent); }
      .check.done { background: var(--slpc-accent); border-color: var(--slpc-accent); }
      .name { flex: 1 1 auto; min-width: 64px; color: var(--primary-text-color); font-size: 0.98rem; cursor: text; overflow-wrap: anywhere; }
      .row.done .name { text-decoration: line-through; color: var(--secondary-text-color); }
      .edit-input { flex: 1; min-width: 0; padding: 6px 10px; font-size: 16px; }
      .badge {
        display: inline-block; font-size: 0.7rem; color: var(--secondary-text-color);
        border: 1px solid var(--divider-color, rgba(127,127,127,0.25));
        border-radius: 999px; padding: 2px 8px; white-space: nowrap;
        max-width: 100%; overflow: hidden; text-overflow: ellipsis; box-sizing: border-box; vertical-align: middle;
      }
      .badge.none { opacity: 0.5; border-style: dashed; }
      .badge-wrap { position: relative; flex: 0 1 auto; min-width: 0; max-width: 34%; cursor: pointer; display: flex; }
      .badge-wrap:hover .badge { border-color: var(--slpc-accent); }
      .badge-select { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; font-size: 16px; }
      .badge-select option { color: var(--primary-text-color); background: var(--card-background-color, #fff); }
      .stepper { display: flex; align-items: center; gap: 2px; flex: 0 0 auto; }
      .step {
        cursor: pointer; border: 1px solid var(--divider-color, rgba(127,127,127,0.3));
        background: transparent; color: var(--secondary-text-color);
        border-radius: 7px; width: 28px; height: 28px; line-height: 1; font-size: 1rem; padding: 0;
        transition: all 0.12s;
      }
      .step:hover { border-color: var(--slpc-accent); color: var(--slpc-accent); }
      .qty { min-width: 22px; text-align: center; font-size: 0.9rem; color: var(--primary-text-color); }
      .row.done .stepper { display: none; }
      .row.pending { opacity: 0.7; }
      .row { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
      .row.dragging { opacity: 0.3; }
      .drag-ghost {
        position: fixed; z-index: 1001; pointer-events: none; box-sizing: border-box; margin: 0;
        background: var(--card-background-color, var(--ha-card-background, #fff));
        box-shadow: 0 12px 32px rgba(0,0,0,0.35); transform: scale(1.03); opacity: 0.95;
      }
      .drop-panel {
        position: fixed; left: 8px; right: 8px; bottom: calc(8px + env(safe-area-inset-bottom, 0px)); z-index: 1000;
        max-height: 45vh; overflow: auto; padding: 12px; border-radius: 16px;
        background: var(--card-background-color, var(--ha-card-background, #fff));
        border: 1px solid var(--divider-color, rgba(127,127,127,0.25));
        box-shadow: 0 -8px 32px rgba(0,0,0,0.3);
      }
      .drop-title { font-size: 0.75rem; color: var(--secondary-text-color); margin: 0 4px 8px; }
      .drop-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
      .drop {
        border: 1.5px dashed var(--divider-color, rgba(127,127,127,0.4)); border-radius: 12px;
        padding: 14px 8px; text-align: center; font-size: 0.88rem; color: var(--primary-text-color);
        transition: transform 0.1s, background 0.1s, border-color 0.1s; overflow-wrap: anywhere;
      }
      .drop.current { opacity: 0.4; }
      .drop.over, .group-label.over {
        border-style: solid; border-color: var(--slpc-accent); color: var(--slpc-accent);
        background: color-mix(in srgb, var(--slpc-accent) 16%, transparent);
      }
      .drop.over { transform: scale(1.05); }
      .row.dragging { pointer-events: none; }
      .group { border-radius: 12px; transition: background 0.12s, box-shadow 0.12s; }
      .group.over { background: color-mix(in srgb, var(--slpc-accent) 8%, transparent); box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--slpc-accent) 55%, transparent); }
      .group.over > .group-label { color: var(--slpc-accent); }
      .empty-group { min-height: 44px; }
      .row.removing { opacity: 0; height: 0; min-height: 0; padding: 0; overflow: hidden; transition: opacity 0.15s; }
      .del {
        flex: 0 0 auto; cursor: pointer; border: none; background: none;
        color: var(--secondary-text-color); font-size: 1.15rem; opacity: 0.35; padding: 4px 8px; border-radius: 6px;
        transition: opacity 0.12s, color 0.12s;
      }
      .row:hover .del { opacity: 0.7; }
      .del:hover { color: var(--error-color, #db4437); opacity: 1; }
      @media (hover: none) { .del { opacity: 0.6; } }
      .empty, .msg { text-align: center; color: var(--secondary-text-color); padding: 28px 12px; font-size: 0.9rem; }
      .msg button { margin-top: 10px; }

      .toast {
        position: sticky; bottom: 8px; margin-top: 12px; display: none; align-items: center; gap: 12px;
        background: var(--primary-text-color, #222); color: var(--card-background-color, #fff);
        border-radius: 10px; padding: 10px 14px; font-size: 0.85rem; box-shadow: 0 6px 18px rgba(0,0,0,0.3); z-index: 50;
      }
      .toast.show { display: flex; }
      .toast-msg { flex: 1; }
      .toast-btn { border: none; background: none; color: var(--slpc-accent); font-weight: 700; cursor: pointer; text-transform: uppercase; font-size: 0.8rem; padding: 4px; }
      @container (min-width: 560px) { .name-wrap { flex: 2 1 200px; } }
      /* Ecrã estreito (telemóvel): grelha com colunas fixas para os botões, que nunca encolhem
         nem saltam de linha; o nome usa o espaço que sobra e a categoria passa para baixo dele. */
      @container (max-width: 459px) {
        .row {
          display: grid; grid-template-columns: auto minmax(0, auto) minmax(0, 1fr) auto auto;
          grid-template-areas: "check name name stepper del" "check badge price stepper del";
          column-gap: 8px; row-gap: 3px;
        }
        .row > .check { grid-area: check; }
        .row > .name, .row > .edit-input { grid-area: name; min-width: 0; overflow-wrap: break-word; word-break: break-word; }
        .row > .badge-wrap { grid-area: badge; justify-self: start; max-width: 100%; }
        .row > .price { grid-area: price; justify-self: start; }
        .row > .stepper { grid-area: stepper; }
        .row > .del { grid-area: del; min-width: 32px; min-height: 32px; padding: 0; display: flex; align-items: center; justify-content: center; }
        .row > .badge-wrap:empty { display: none; }
        .row:not(:has(> .badge-wrap, > .price)) { grid-template-areas: "check name name stepper del"; }
      }
    `;
  }

  _buildChrome() {
    if (this._chromeBuilt) {
      const t = this.shadowRoot.querySelector(".title");
      if (t) t.textContent = this._config.title || "";
      this._syncToggles();
      return;
    }
    this.shadowRoot.innerHTML = `
      <style>${this._styles()}</style>
      <ha-card>
        <div class="header">
          <span class="title"></span>
          <span class="counts"></span>
        </div>
        <div class="add-row">
          <div class="combo name-wrap">
            <input class="field add-input" type="text" autocomplete="off" enterkeyhint="done"
                   placeholder="Adicionar… (ex.: 2 ovos, leite, pão)" aria-label="Novo artigo" />
            <div class="dropdown suggestions" role="listbox"></div>
          </div>
          <div class="qty-box" title="Quantidade">
            <button class="qty-dec" type="button" aria-label="Menos">−</button>
            <input class="field qty-input" type="number" inputmode="numeric" min="1" max="${MAX_QTY}" value="1" aria-label="Quantidade" />
            <button class="qty-inc" type="button" aria-label="Mais">+</button>
          </div>
          <div class="combo cat-wrap">
            <input class="field cat-input" type="text" autocomplete="off" placeholder="Categoria (auto)" aria-label="Categoria" />
            <div class="dropdown cat-dropdown" role="listbox"></div>
          </div>
          <button class="add-btn" type="button">Adicionar</button>
        </div>
        <div class="hint"></div>
        <div class="recs" hidden>
          <div class="recs-label">Sugestões para ti</div>
          <div class="recs-row"></div>
        </div>
        <div class="search-wrap">
          <input class="field search-input" type="search" placeholder="Procurar na lista…" aria-label="Procurar" />
          <button class="search-clear" type="button" aria-label="Limpar pesquisa">×</button>
        </div>
        <div class="toolbar">
          <button class="toggle t-group" type="button">Agrupar</button>
          <button class="toggle t-done" type="button">Mostrar comprados</button>
          <button class="toggle auto-cat" type="button" hidden title="Adivinhar a categoria dos artigos sem categoria"></button>
          <button class="toggle clear-done" type="button" hidden>Limpar comprados</button>
          <button class="toggle t-cont" type="button" hidden>🛒 Continente</button>
        </div>
        <div class="cont-panel" hidden></div>
        <div class="chips"></div>
        <div class="banner"><span class="banner-msg"></span><button class="banner-btn" type="button">Mostrar tudo</button></div>
        <div class="list"></div>
        <div class="toast" role="status"><span class="toast-msg"></span><button class="toast-btn" type="button"></button></div>
      </ha-card>
    `;
    this._chromeBuilt = true;
    this.shadowRoot.querySelector(".title").textContent = this._config.title || "";
    this._wireAddRow();
    this._wireFilters();
    this._wireList();
    this._wireDrag();
    this._syncToggles();
  }

  _$(s) { return this.shadowRoot.querySelector(s); }

  _syncToggles() {
    const g = this._$(".t-group");
    const d = this._$(".t-done");
    if (g) g.classList.toggle("active", this._groupByCategory);
    if (d) d.classList.toggle("active", this._showCompleted);
  }

  _resetAddRow() {
    this._$(".add-input").value = "";
    this._$(".cat-input").value = "";
    this._$(".cat-input").classList.remove("auto");
    this._$(".qty-input").value = 1;
    this._catAuto = false;
    this._$(".hint").textContent = "";
    this._closeSuggestions();
    this._closeCatOptions();
  }

  async _commit() {
    const addInput = this._$(".add-input");
    const text = addInput.value;
    if (!text.trim()) { addInput.focus(); return; }
    const qty = this._$(".qty-input").value;
    const cat = this._catAuto ? "" : this._$(".cat-input").value;
    this._resetAddRow();
    addInput.focus();
    try {
      const name = await this._addMany(text, qty, cat);
      if (name) this._revealIfHidden(name);
    } catch (_) { /* toast já mostrado */ }
  }

  /** Se o artigo acabado de adicionar ficaria escondido pelos filtros, limpa-os. */
  _revealIfHidden(name) {
    const category = this._categoryFor(name);
    const fake = { name, category, catKey: norm(category), done: false };
    if (this._matchesSearch(fake) && this._matchesCats(fake)) return;
    this._revealAll();
    this._toast(`Filtros limpos para veres “${name}”`);
  }

  /** Mostra a categoria adivinhada enquanto se escreve (pode ser alterada). */
  _updateAutoCat() {
    const catInput = this._$(".cat-input");
    const text = this._$(".add-input").value;
    const hint = this._$(".hint");
    if (catInput.value && !this._catAuto) return;
    const parts = splitMulti(text);
    if (parts.length > 1) {
      catInput.value = "";
      catInput.classList.remove("auto");
      this._catAuto = false;
      hint.textContent = `${parts.length} artigos — cada um fica com a sua categoria`;
      return;
    }
    const name = splitQty(text).name;
    const guess = name ? this._categoryFor(name) : "";
    catInput.value = guess;
    catInput.classList.toggle("auto", !!guess);
    this._catAuto = !!guess;
    const q = splitQty(text).qty;
    hint.textContent = q ? `Quantidade: ${q}` : "";
  }

  _wireAddRow() {
    const addInput = this._$(".add-input");
    const catInput = this._$(".cat-input");
    const qtyInput = this._$(".qty-input");
    const enter = (e) => e.key === "Enter" && !e.isComposing && e.keyCode !== 229;

    this._$(".add-btn").addEventListener("click", () => this._commit());
    this._$(".qty-dec").addEventListener("click", () => { qtyInput.value = clampQty(qtyInput.value) - 1 || 1; });
    this._$(".qty-inc").addEventListener("click", () => { qtyInput.value = clampQty(clampQty(qtyInput.value) + 1); });
    qtyInput.addEventListener("change", () => { qtyInput.value = clampQty(qtyInput.value); });
    qtyInput.addEventListener("keydown", (e) => { if (enter(e)) { e.preventDefault(); this._commit(); } });

    /* --- nome: sugestões --- */
    addInput.addEventListener("input", () => {
      this._suggestions = this._computeSuggestions(addInput.value);
      this._sugIndex = -1;
      this._renderSuggestions();
      this._updateAutoCat();
    });
    addInput.addEventListener("keydown", (e) => {
      const n = this._suggestions.length;
      if (e.key === "ArrowDown" && n) { e.preventDefault(); this._sugIndex = (this._sugIndex + 1) % n; this._renderSuggestions(); }
      else if (e.key === "ArrowUp" && n) { e.preventDefault(); this._sugIndex = (this._sugIndex - 1 + n) % n; this._renderSuggestions(); }
      else if (enter(e)) {
        e.preventDefault();
        if (this._sugIndex >= 0) this._activateSuggestion(this._sugIndex);
        else this._commit();
      } else if (e.key === "Escape") { this._closeSuggestions(); }
    });
    addInput.addEventListener("paste", () => setTimeout(() => this._updateAutoCat(), 0));
    addInput.addEventListener("blur", () => setTimeout(() => this._closeSuggestions(), 200));
    // pointerdown só impede o blur; a escolha acontece no click (evita "tap-through" em ecrãs táteis)
    this._$(".suggestions").addEventListener("pointerdown", (e) => { if (e.target.closest(".opt")) e.preventDefault(); });
    this._$(".suggestions").addEventListener("click", (e) => {
      const el = e.target.closest(".opt");
      if (el) this._activateSuggestion(parseInt(el.dataset.i, 10));
    });

    /* --- categoria: combobox --- */
    const openCat = () => {
      this._catOptions = this._computeCatOptions(this._catAuto ? "" : catInput.value);
      this._catIndex = -1;
      this._renderCatOptions();
    };
    catInput.addEventListener("focus", () => {
      if (this._catAuto) catInput.select();
      openCat();
    });
    catInput.addEventListener("input", () => {
      this._catAuto = false;
      catInput.classList.remove("auto");
      openCat();
    });
    catInput.addEventListener("keydown", (e) => {
      const n = this._catOptions.length;
      if (e.key === "ArrowDown" && n) { e.preventDefault(); this._catIndex = (this._catIndex + 1) % n; this._renderCatOptions(); }
      else if (e.key === "ArrowUp" && n) { e.preventDefault(); this._catIndex = (this._catIndex - 1 + n) % n; this._renderCatOptions(); }
      else if (enter(e)) {
        e.preventDefault();
        if (this._catIndex >= 0) this._activateCatOption(this._catIndex);
        else this._commit();
      } else if (e.key === "Escape") { this._closeCatOptions(); }
    });
    catInput.addEventListener("blur", () => setTimeout(() => this._closeCatOptions(), 200));
    this._$(".cat-dropdown").addEventListener("pointerdown", (e) => { if (e.target.closest(".opt")) e.preventDefault(); });
    this._$(".cat-dropdown").addEventListener("click", (e) => {
      const el = e.target.closest(".opt");
      if (el) this._activateCatOption(parseInt(el.dataset.i, 10));
    });

    /* --- recomendações --- */
    this._$(".recs-row").addEventListener("click", (e) => {
      const x = e.target.closest(".x");
      const rec = e.target.closest(".rec");
      if (!rec) return;
      if (x) { e.stopPropagation(); this._snooze(rec.dataset.key); return; }
      const r = (this._recs || []).find((o) => o.key === rec.dataset.key);
      if (!r) return;
      const addBtn = rec.querySelector(".rec-add");
      if (!e.target.closest(".rec-add") || addBtn.disabled) return;
      addBtn.disabled = true;
      rec.classList.add("pending");
      this._addItem(r.name, 1, r.category).then((name) => name && this._revealIfHidden(name)).catch(() => {});
    });
  }

  _wireFilters() {
    const search = this._$(".search-input");
    const clear = this._$(".search-clear");
    search.addEventListener("input", () => {
      this._search = search.value;
      clear.style.display = search.value ? "block" : "none";
      this._renderList();
    });
    clear.addEventListener("click", () => {
      search.value = "";
      this._search = "";
      clear.style.display = "none";
      this._renderList();
      search.focus();
    });

    this._$(".t-group").addEventListener("click", () => {
      this._groupByCategory = !this._groupByCategory;
      this._syncToggles();
      this._savePrefs();
      this._renderList();
    });
    this._$(".t-done").addEventListener("click", () => {
      this._showCompleted = !this._showCompleted;
      this._syncToggles();
      this._savePrefs();
      this._renderDynamic();
    });
    this._$(".clear-done").addEventListener("click", () => this._clearCompleted());
    this._$(".t-cont").addEventListener("click", () => this._openCont(this._contMode && this._contMode.type === "send" ? null : { type: "send" }));
    this._wireCont();
    this._$(".auto-cat").addEventListener("click", () => this._autoCategorizeAll());
    this._$(".banner-btn").addEventListener("click", () => {
      this._revealAll();
      if (!this._showCompleted) { this._showCompleted = true; this._syncToggles(); this._savePrefs(); }
      this._renderDynamic();
    });

    this._$(".chips").addEventListener("click", (e) => {
      const el = e.target.closest(".chip");
      if (!el) return;
      const cat = el.dataset.cat;
      if (this._activeCats.has(cat)) this._activeCats.delete(cat);
      else this._activeCats.add(cat);
      this._savePrefs();
      this._renderDynamic();
    });

    this._$(".toast-btn").addEventListener("click", () => {
      const fn = this._toastAction;
      this._hideToast();
      if (fn) fn();
    });
  }

  _wireList() {
    const list = this._$(".list");
    list.addEventListener("click", (e) => {
      if (this._suppressClick) { this._suppressClick = false; return; }   // fim de um arrasto
      const el = e.target.closest("[data-action]");
      if (!el) return;
      const uid = el.dataset.uid;
      const action = el.dataset.action;
      if (action === "toggle") this._toggleItem(uid, el);
      else if (action === "delete") this._removeItem(uid, el);
      else if (action === "edit") this._startEdit(uid, el);
      else if (action === "retry") this._resubscribe();
      else if (action === "price") this._openCont({ type: "pick", uid });
      else if (action === "inc" || action === "dec") this._bumpQty(uid, action === "inc" ? 1 : -1, el);
    });
    list.addEventListener("change", (e) => {
      const sel = e.target.closest("select.badge-select");
      if (!sel) return;
      const uid = sel.dataset.uid;
      let cat = sel.value;
      if (cat === "__new__") {
        cat = (window.prompt("Nome da nova categoria:") || "").trim();
        if (!cat) { this._renderList(); return; }
      }
      this._setCategory(uid, cat);
    });
  }

  /** Muda a categoria de um artigo e lembra-a para a próxima vez. */
  _setCategory(uid, cat) {
    const raw = this._findRaw(uid);
    if (!raw) return Promise.resolve();
    const p = this._parse(raw);
    if (cat) this._addCat(cat);
    const key = norm(p.effName);
    if (this._catalog[key]) { this._catalog[key].category = cat; this._saveCatalog(); }
    return this._updateItem({ uid }, { category: cat }).catch(() => {});
  }

  /* ---------------- Arrastar para mudar de categoria ---------------- */

  /** Manter premido um artigo (~0,4 s) e arrastá-lo para uma categoria do painel ou para um grupo. */
  _wireDrag() {
    const list = this._$(".list");
    const HOLD = 420;
    const SLOP = 10;
    let press = null;
    const cancelPress = () => {
      if (!press) return;
      clearTimeout(press.timer);
      press = null;
      this._press = false;
      // render adiado durante o toque; espera pelo click (um toque curto abre a edição)
      if (this._renderSkipped) setTimeout(() => this._renderList(), 350);
    };
    list.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || this._editing || this._drag) return;
      const row = e.target.closest(".row");
      if (!row || e.target.closest("button, select, input, label")) return;
      const ref = row.querySelector("[data-uid]");
      if (!ref) return;
      cancelPress();
      press = { id: e.pointerId, x: e.clientX, y: e.clientY, row, uid: ref.dataset.uid };
      this._press = true;
      press.timer = setTimeout(() => { const p = press; press = null; this._press = false; if (p) this._startDrag(p); }, HOLD);
    });
    list.addEventListener("pointermove", (e) => {
      if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP) cancelPress();
    });
    list.addEventListener("pointerup", cancelPress);
    list.addEventListener("pointercancel", cancelPress);
    // durante o arrasto o dedo não faz scroll, e o menu de toque longo não aparece
    list.addEventListener("touchmove", (e) => { if (this._drag) e.preventDefault(); }, { passive: false });
    list.addEventListener("contextmenu", (e) => { if (this._drag || press) e.preventDefault(); });
  }

  /**
   * Arrasto de um artigo. Vista agrupada: a linha anda pela lista e muda de grupo
   * (para cima ou para baixo, com scroll automático). Sem grupos: painel de categorias.
   */
  _startDrag({ id, x, row, uid }) {
    const raw = this._findRaw(uid);
    if (!raw || !row.isConnected || this._editing) { this._renderList(); return; }
    const it = this._parse(raw);
    const inList = this._groupByCategory && !it.done && !!row.closest(".group");
    if (navigator.vibrate) navigator.vibrate(15);
    const rect = row.getBoundingClientRect();
    const ghost = row.cloneNode(true);
    ghost.classList.add("drag-ghost");
    Object.assign(ghost.style, { width: `${rect.width}px`, left: `${rect.left}px`, top: `${rect.top}px` });
    const panel = inList ? null : this._dropPanel(it);
    const extra = inList ? this._addEmptyGroups() : [];
    this.shadowRoot.append(...[ghost, panel].filter(Boolean));
    row.classList.add("dragging");
    const home = row.closest(".group");
    if (home) home.classList.add("over");
    const offX = x - rect.left;
    const offY = rect.height + 12;   // o artigo fica acima do dedo, para se ver onde se larga
    const scroller = this._scrollParent();
    // a "scroll anchoring" do browser compensaria a linha a mudar de sítio e anularia o scroll automático
    const prevAnchor = scroller.style.overflowAnchor;
    scroller.style.overflowAnchor = "none";
    let lastX = x;
    let lastY = 0;
    let over = home;
    let raf = 0;

    const setOver = (t) => {
      if (t === over) return;
      if (over) over.classList.remove("over");
      over = t;
      if (over) { over.classList.add("over"); if (navigator.vibrate) navigator.vibrate(5); }
    };
    const update = () => {
      ghost.style.left = `${lastX - offX}px`;
      ghost.style.top = `${lastY - offY}px`;
      const el = this.shadowRoot.elementFromPoint(lastX, lastY);
      if (!inList) { setOver(el && el.closest("[data-drop]:not(.current)")); return; }
      const g = el && el.closest(".group[data-drop]");
      if (!g) return;   // fora dos grupos: fica onde estava
      const r = el.closest(".row");
      if (r && r !== row && g.contains(r)) {
        const rb = r.getBoundingClientRect();
        if (lastY > rb.top + rb.height / 2) { if (r.nextElementSibling !== row) r.after(row); }
        else if (r.previousElementSibling !== row) r.before(row);
      } else if (!g.contains(row)) {
        g.querySelector(".group-label").after(row);
      }
      setOver(row.closest(".group"));
    };
    // scroll automático quando o dedo está perto do topo ou do fundo do ecrã
    const tick = () => {
      raf = 0;
      if (!this._drag) return;
      const edge = 80;
      const vh = window.innerHeight;
      let dy = 0;
      if (lastY < edge) dy = -Math.ceil((edge - lastY) / 5);
      else if (lastY > vh - edge) dy = Math.ceil((lastY - (vh - edge)) / 5);
      if (!dy) return;
      scroller.scrollBy(0, dy);
      update();
      raf = requestAnimationFrame(tick);
    };
    const move = (e) => {
      if (e.pointerId !== id) return;
      if (e.cancelable) e.preventDefault();
      lastX = e.clientX;
      lastY = e.clientY;
      update();
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const finish = (drop) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      cancelAnimationFrame(raf);
      scroller.style.overflowAnchor = prevAnchor;
      ghost.remove();
      if (panel) panel.remove();
      if (over) over.classList.remove("over");
      row.classList.remove("dragging");
      const target = drop ? (inList ? row.closest(".group") : over) : null;
      extra.forEach((g) => g.remove());
      this._drag = null;
      this._suppressClick = true;   // o click que vem a seguir ao largar não abre a edição
      setTimeout(() => { this._suppressClick = false; }, 400);
      if (target) {
        const cat = target.dataset.drop === UNCAT ? "" : target.dataset.drop;
        if (norm(cat) !== it.catKey) {
          this._setCategory(uid, cat);
          this._toast(`“${it.name}” → ${cat || "sem categoria"}`);
        }
      }
      this._renderDynamic();
    };
    const up = (e) => { if (e.pointerId === id) finish(true); };
    const cancel = (e) => { if (e.pointerId === id) finish(false); };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    this._drag = { uid, cancel: () => finish(false) };
  }

  /** Durante o arrasto, as categorias sem artigos por comprar aparecem como grupos vazios. */
  _addEmptyGroups() {
    const list = this._$(".list");
    const groups = [...list.querySelectorAll(".group[data-drop]")];
    const have = new Set(groups.map((g) => (g.dataset.drop === UNCAT ? UNCAT : norm(g.dataset.drop))));
    const added = [];
    const all = this._knownCats().map((c) => [norm(c), c]).concat([[UNCAT, "Sem categoria"]]);
    for (const [key, label] of all) {
      if (have.has(key)) continue;
      const g = document.createElement("div");
      g.className = "group empty-group";
      g.dataset.drop = key === UNCAT ? UNCAT : label;
      g.innerHTML = `<div class="group-label"><span>${esc(label)}</span><span>0</span></div>`;
      const before = key === UNCAT ? null : groups.find((o) => o.dataset.drop === UNCAT
        || o.dataset.drop.localeCompare(label, "pt") > 0);
      const anchor = before || list.querySelector(".group-label.done-label");
      if (anchor) anchor.before(g);
      else if (groups.length) groups[groups.length - 1].after(g);
      else list.prepend(g);
      groups.push(g);
      groups.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
      added.push(g);
    }
    return added;
  }

  /** Elemento que faz scroll à volta do card (no HA pode não ser a janela). */
  _scrollParent() {
    let n = this.parentNode || this.getRootNode().host;
    while (n && n !== document) {
      if (n instanceof Element) {
        const oy = getComputedStyle(n).overflowY;
        if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight) return n;
      }
      n = n.assignedSlot || n.parentNode || (n instanceof ShadowRoot ? n.host : null);
    }
    return document.scrollingElement || document.documentElement;
  }

  /** Painel fixo no fundo do ecrã com as categorias onde largar o artigo. */
  _dropPanel(it) {
    const panel = document.createElement("div");
    panel.className = "drop-panel";
    const cats = this._knownCats();
    const cell = (value, label, current) =>
      `<div class="drop${current ? " current" : ""}" data-drop="${esc(value)}">${esc(label)}</div>`;
    panel.innerHTML = `<div class="drop-title">Largar em…</div><div class="drop-grid">${
      cats.map((c) => cell(c, c, norm(c) === it.catKey)).join("")
      + cell(UNCAT, "Sem categoria", !it.category)}</div>`;
    return panel;
  }

  /** +/−: mostra logo o novo valor e envia uma só atualização depois de parar de tocar. */
  _bumpQty(uid, delta, btn) {
    const raw = this._findRaw(uid);
    if (!raw) return;
    this._qtyDraft = this._qtyDraft || new Map();
    this._qtyTimers = this._qtyTimers || new Map();
    const cur = this._qtyDraft.has(uid) ? this._qtyDraft.get(uid) : this._parse(raw).qty;
    const nq = clampQty(cur + delta);
    if (nq === cur) return;
    this._qtyDraft.set(uid, nq);
    const span = btn && btn.parentNode && btn.parentNode.querySelector(".qty");
    if (span) span.textContent = nq;
    clearTimeout(this._qtyTimers.get(uid));
    this._qtyTimers.set(uid, setTimeout(() => {
      this._qtyTimers.delete(uid);
      const q = this._qtyDraft.get(uid);
      this._setQty(uid, q);
      setTimeout(() => {   // mantém o valor até chegar a confirmação do HA
        if (!this._qtyTimers.has(uid) && this._qtyDraft.get(uid) === q) this._qtyDraft.delete(uid);
      }, 1500);
    }, 400));
  }

  _startEdit(uid, nameEl) {
    const raw = this._findRaw(uid);
    if (!raw || this._editing) return;
    const p = this._parse(raw);
    this._editing = uid;
    const input = document.createElement("input");
    input.className = "field edit-input";
    input.value = p.qty > 1 ? `${p.qty}x ${p.name}` : p.name;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      this._editing = null;
      const { qty, name } = splitQty(input.value);
      const changed = save && name && (name !== p.name || (qty || 1) !== p.qty);
      if (changed) this._updateItem({ uid }, { name, qty: qty || 1 }).catch(() => {});
      // repõe só o nome (redesenhar a lista já engoliria o toque que terminou a edição)
      const div = document.createElement("div");
      div.className = "name";
      div.dataset.action = "edit";
      div.dataset.uid = uid;
      div.textContent = changed ? name : p.name;
      if (input.isConnected) input.replaceWith(div);
      setTimeout(() => this._renderList(), 350);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); finish(true); }
      else if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
  }

  /* ---------------- Activation helpers ---------------- */

  _activateSuggestion(i) {
    const s = this._suggestions[i];
    if (!s) return;
    const qtyText = this._$(".add-input").value;
    const typedQty = splitQty(qtyText).qty;
    const fieldQty = clampQty(this._$(".qty-input").value);
    const qty = typedQty && fieldQty === 1 ? typedQty : fieldQty;
    const cat = this._catAuto ? "" : this._$(".cat-input").value.trim();
    this._resetAddRow();
    this._$(".add-input").focus();
    this._addItem(s.name, qty, cat || s.category || "")
      .then((name) => name && this._revealIfHidden(name))
      .catch(() => {});
  }

  _closeSuggestions() {
    this._suggestions = [];
    this._sugIndex = -1;
    this._renderSuggestions();
  }

  _activateCatOption(i) {
    const o = this._catOptions[i];
    if (!o) return;
    const catInput = this._$(".cat-input");
    catInput.value = o.name;
    catInput.classList.remove("auto");
    this._catAuto = false;
    this._closeCatOptions();
    this._$(".add-input").focus();
  }

  _closeCatOptions() {
    this._catOptions = [];
    this._catIndex = -1;
    this._renderCatOptions();
  }

  /* ---------------- Toast ---------------- */

  _toast(msg, actionLabel, action) {
    const t = this._$(".toast");
    if (!t) return;
    this._$(".toast-msg").textContent = msg;
    const btn = this._$(".toast-btn");
    btn.textContent = actionLabel || "";
    btn.style.display = actionLabel ? "" : "none";
    this._toastAction = action || null;
    t.classList.add("show");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this._hideToast(), action ? 6000 : 3000);
  }

  _hideToast() {
    clearTimeout(this._toastTimer);
    this._toastAction = null;
    const t = this._$(".toast");
    if (t) t.classList.remove("show");
  }

  /* ---------------- Dynamic rendering ---------------- */

  _renderDynamic() {
    if (!this._chromeBuilt || !this._config) return;
    this._renderChips();
    this._renderList();
    this._renderCounts();
    this._renderRecs();
  }

  _renderCounts() {
    const parsed = this._allParsed();
    const pending = parsed.filter((i) => !i.done);
    const units = pending.reduce((n, i) => n + i.qty, 0);
    const done = parsed.length - pending.length;
    const el = this._$(".counts");
    if (!this._loaded) { el.textContent = ""; return; }
    const dot = this._live ? "" : `<span class="live-dot" title="Sem atualização em tempo real — a atualizar periodicamente"></span>`;
    const est = this._contTotal();
    // cada parte fica inteira; em ecrãs estreitos o contador parte entre partes em vez de transbordar
    const segs = [`<b>${pending.length}</b> por comprar`];
    if (units !== pending.length) segs.push(`${units} unid.`);
    if (est != null) segs.push(`≈ <b>${fmtEur(est)}</b>`);
    if (done) segs.push(`${done} comprado${done > 1 ? "s" : ""}`);
    el.innerHTML = segs.map((s, i) => `<span class="seg">${i ? "· " : ""}${s}${i === segs.length - 1 ? dot : ""}</span>`).join(" ");
    const tc = this._$(".t-cont");
    if (tc) { tc.hidden = !this._contSensor(); tc.classList.toggle("active", !!(this._contMode && this._contMode.type === "send")); }
    const autoCat = this._$(".auto-cat");
    const n = this._autoCatCandidates().length;
    autoCat.hidden = !n;
    autoCat.textContent = `Categorizar (${n})`;
    const clear = this._$(".clear-done");
    clear.hidden = !done;
    clear.textContent = `Limpar comprados (${done})`;
  }

  _renderRecs() {
    const box = this._$(".recs");
    if (!box) return;
    const limit = Math.max(0, parseInt(this._config.recommendations, 10) || 0);
    if (!limit || !this._loaded) { box.hidden = true; this._recs = []; return; }
    this._recs = this._computeRecs(limit);
    box.hidden = !this._recs.length;
    this._$(".recs-row").innerHTML = this._recs.map((r) => `
      <span class="rec" data-key="${esc(r.key)}">
        <button class="rec-add" type="button" title="${esc(r.reason)}${r.category ? " · " + esc(r.category) : ""}" aria-label="Adicionar ${esc(r.name)}"><span class="plus">+</span>${esc(r.name)}</button>
        <button class="x" type="button" aria-label="Agora não: ${esc(r.name)}" title="Agora não">×</button>
      </span>`).join("");
  }

  _renderSuggestions() {
    const box = this._$(".suggestions");
    const sugs = this._suggestions;
    if (!sugs.length) { box.innerHTML = ""; box.style.display = "none"; return; }
    box.style.display = "block";
    box.innerHTML = sugs.map((s, i) => {
      const badge = s.category ? `<span class="badge">${esc(s.category)}</span>` : "";
      const meta = s.kind === "list" ? `na lista ×${s.qty} · +1`
        : s.kind === "done" ? "comprado · voltar a pôr"
        : s.count ? `pedido ${s.count}×` : "adicionar";
      return `<div class="opt${i === this._sugIndex ? " hi" : ""}" data-i="${i}" role="option">
        <span class="opt-name">${esc(s.name)}</span>${badge}<span class="opt-meta">${meta}</span></div>`;
    }).join("");
  }

  _renderCatOptions() {
    const box = this._$(".cat-dropdown");
    const opts = this._catOptions;
    if (!opts.length) { box.innerHTML = ""; box.style.display = "none"; return; }
    box.style.display = "block";
    box.innerHTML = opts.map((o, i) => {
      const hi = i === this._catIndex ? " hi" : "";
      if (o.create) {
        return `<div class="opt create${hi}" data-i="${i}" role="option">
          <span class="opt-name">Criar “${esc(o.name)}”</span><span class="opt-meta">nova categoria</span></div>`;
      }
      return `<div class="opt${o.preset ? " preset" : ""}${hi}" data-i="${i}" role="option">
        <span class="opt-name">${esc(o.name)}</span>${o.preset ? `<span class="opt-meta">sugerida</span>` : ""}</div>`;
    }).join("");
  }

  _renderChips() {
    const cats = this._itemCats();
    const parsed = this._allParsed().filter((i) => this._showCompleted || !i.done);
    const hasUncat = parsed.some((i) => !i.category);
    const box = this._$(".chips");
    // Só se limpam filtros obsoletos depois de a lista estar carregada.
    if (this._loaded) {
      const valid = new Set(cats.map(([k]) => k));
      if (this._allParsed().some((i) => !i.category)) valid.add(UNCAT);
      let pruned = false;
      for (const c of [...this._activeCats]) if (!valid.has(c)) { this._activeCats.delete(c); pruned = true; }
      if (pruned) this._savePrefs();
    }
    if (cats.length + (hasUncat ? 1 : 0) < 2 && this._activeCats.size === 0) { box.innerHTML = ""; return; }
    const counts = new Map();
    for (const i of parsed) if (!i.done) { const k = i.category ? i.catKey : UNCAT; counts.set(k, (counts.get(k) || 0) + 1); }
    const count = (k) => counts.get(k) || 0;
    const parts = cats.map(([k, label]) => {
      const active = this._activeCats.has(k) ? " active" : "";
      return `<button class="chip${active}" type="button" data-cat="${esc(k)}">${esc(label)}<span class="n">${count(k)}</span></button>`;
    });
    if (hasUncat) {
      const active = this._activeCats.has(UNCAT) ? " active" : "";
      parts.push(`<button class="chip${active}" type="button" data-cat="${UNCAT}">sem categoria<span class="n">${count(UNCAT)}</span></button>`);
    }
    box.innerHTML = parts.join("");
  }

  _renderList() {
    const list = this._$(".list");
    if (!list) return;
    // não destruir edição, toque longo ou arrasto em curso; volta a desenhar no fim
    if (this._editing || this._drag || this._press) { this._renderSkipped = true; return; }
    this._renderSkipped = false;
    const banner = this._$(".banner");
    banner.style.display = "none";
    if (this._error && !this._loaded) {
      const msg = esc(String((this._error && this._error.message) || this._error));
      list.innerHTML = `<div class="msg">Não foi possível ler a lista: ${msg}<br>
        <button class="toggle" type="button" data-action="retry">Tentar outra vez</button></div>`;
      return;
    }
    if (!this._loaded) { list.innerHTML = `<div class="msg">A carregar…</div>`; return; }

    const all = this._allParsed();
    const visible = all.filter((i) => this._matchesFilters(i));
    const visibleSet = new Set(visible);
    const hidden = all.filter((i) => !i.done && !visibleSet.has(i)).length;
    const hiddenDone = !this._showCompleted ? all.filter((i) => i.done).length : 0;
    if (hidden > 0) {
      this._$(".banner-msg").textContent =
        `${hidden} artigo${hidden > 1 ? "s" : ""} por comprar escondido${hidden > 1 ? "s" : ""} pela pesquisa/filtros`;
      banner.style.display = "flex";
    }

    if (visible.length === 0) {
      const txt = all.length === 0 ? "A lista está vazia. Adiciona algo acima 🛒"
        : hidden ? "Nada corresponde aos filtros."
        : hiddenDone ? `Tudo comprado! 🎉 (${hiddenDone} comprado${hiddenDone > 1 ? "s" : ""} escondido${hiddenDone > 1 ? "s" : ""})`
        : "Nada por aqui. 🛒";
      list.innerHTML = `<div class="empty">${txt}</div>`;
      return;
    }

    this._rowCats = this._knownCats().map((c) => [c, norm(c), esc(c)]);
    const pending = visible.filter((i) => !i.done);
    const done = visible.filter((i) => i.done);
    let html = this._groupByCategory ? this._renderGrouped(pending) : pending.map((i) => this._rowHtml(i)).join("");
    if (done.length) {
      html += `<div class="group-label done-label"><span>Comprados</span><span>${done.length}</span></div>`;
      html += done.map((i) => this._rowHtml(i)).join("");
    }
    list.innerHTML = html;
  }

  _renderGrouped(items) {
    const groups = new Map();
    for (const it of items) {
      const key = it.catKey || UNCAT;
      if (!groups.has(key)) groups.set(key, { label: it.category || "Sem categoria", rows: [] });
      groups.get(key).rows.push(it);
    }
    const keys = [...groups.keys()].sort((a, b) => {
      if (a === UNCAT) return 1;
      if (b === UNCAT) return -1;
      return groups.get(a).label.localeCompare(groups.get(b).label, "pt");
    });
    return keys.map((k) => {
      const g = groups.get(k);
      return `<div class="group" data-drop="${k === UNCAT ? UNCAT : esc(g.label)}">`
        + `<div class="group-label"><span>${esc(g.label)}</span><span>${g.rows.length}</span></div>`
        + g.rows.map((i) => this._rowHtml(i)).join("") + `</div>`;
    }).join("");
  }

  _catSelectHtml(it) {
    const cats = this._rowCats || this._knownCats().map((c) => [c, norm(c), esc(c)]);
    const extra = it.category && !cats.some(([, k]) => k === it.catKey)
      ? `<option value="${esc(it.category)}" selected>${esc(it.category)}</option>` : "";
    const opts = [`<option value=""${it.category ? "" : " selected"}>Sem categoria</option>`]
      .concat(cats.map(([, k, e]) => `<option value="${e}"${k === it.catKey ? " selected" : ""}>${e}</option>`))
      .concat([extra, `<option value="__new__">+ Nova categoria…</option>`]);
    return `<label class="badge-wrap" title="Mudar categoria">
      <span class="badge${it.category ? "" : " none"}">${it.category ? esc(it.category) : "+ categoria"}</span>
      <select class="badge-select" data-uid="${esc(it.uid)}" aria-label="Categoria de ${esc(it.name)}">${opts.join("")}</select>
    </label>`;
  }

  /* ---------------- Continente (integração ha-continente) ---------------- */

  /** Sensor de preços da integração: o configurado, ou o que segue esta lista. */
  _contSensor() {
    const c = this._config && this._config.continente;
    if (c === false || !this._hass) return null;
    if (typeof c === "string" && c) return this._hass.states[c] ? c : null;
    // sem sensor ainda: volta a procurar no máximo a cada minuto (integração instalada depois)
    if (this._contAutoFor === this._config.entity && (this._contAuto || Date.now() - this._contAutoAt < 60000)) return this._contAuto;
    this._contAutoAt = Date.now();
    const id = Object.keys(this._hass.states).find((k) => k.startsWith("sensor.")
      && this._hass.states[k].attributes.todo_entity === this._config.entity
      && Array.isArray(this._hass.states[k].attributes.items));
    this._contAutoFor = this._config.entity;
    this._contAuto = id || null;
    return this._contAuto;
  }

  /** uid -> {product, alternatives, qty, line_total, source} a partir dos atributos do sensor. */
  _contItems() {
    if (this._contMap) return this._contMap;
    const st = this._contState;
    const map = new Map();
    if (st && Array.isArray(st.attributes.items)) for (const it of st.attributes.items) map.set(it.uid, it);
    this._contMap = map;
    return map;
  }

  _contTotal() {
    const st = this._contState;
    if (!st || st.state === "unavailable" || st.state === "unknown") return null;
    const v = parseFloat(st.state);
    return isNaN(v) ? null : v;
  }

  _priceHtml(it) {
    if (!this._contSensor()) return "";
    const c = this._contItems().get(it.uid);
    if (!c) return `<button class="price pending" type="button" data-action="price" data-uid="${esc(it.uid)}" title="À espera do preço do Continente">…</button>`;
    const p = c.product;
    if (!p) return `<button class="price missing" type="button" data-action="price" data-uid="${esc(it.uid)}" title="Não encontrado no Continente: tocar para procurar">?</button>`;
    const off = p.available === false ? " off" : "";
    const tip = `${p.name}${p.available === false ? " (esgotado)" : ""} — tocar para trocar`;
    return `<button class="price${off}${c.source === "escolhido" ? " chosen" : ""}" type="button" data-action="price" data-uid="${esc(it.uid)}" title="${esc(tip)}">${fmtEur(c.line_total ?? p.price)}</button>`;
  }

  /** Chama uma ação do HA e devolve a resposta (return_response). */
  async _contCall(service, data) {
    const res = await this._hass.connection.sendMessagePromise({
      type: "call_service", domain: "continente", service, service_data: data || {}, return_response: true,
    });
    return res && res.response;
  }

  _openCont(mode) {
    this._contMode = mode;
    this._contResult = null;
    this._contSearch = null;
    this._renderCont();
    this._renderCounts();
    if (mode) {
      const panel = this._$(".cont-panel");
      if (panel && panel.scrollIntoView) panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  _wireCont() {
    const panel = this._$(".cont-panel");
    panel.addEventListener("click", async (e) => {
      const el = e.target.closest("[data-c]");
      if (!el || this._contBusy) return;
      const act = el.dataset.c;
      if (act === "close") return this._openCont(null);
      if (act === "swap") return this._openCont({ type: "pick", uid: el.dataset.uid, back: "send" });
      if (act === "back") return this._openCont({ type: this._contMode.back });
      const busy = async (fn) => {
        this._contBusy = true; panel.classList.add("busy");
        try { await fn(); } catch (err) { this._toast(`Continente: ${(err && err.message) || err}`); }
        finally { this._contBusy = false; panel.classList.remove("busy"); }
      };
      if (act === "choose" || act === "forget") {
        const raw = this._findRaw(this._contMode.uid);
        if (!raw) return this._openCont(null);
        const name = this._parse(raw).name;
        await busy(async () => {
          await this._contCall("choose_product", act === "choose" ? { item: name, sku: el.dataset.sku } : { item: name });
          this._toast(act === "choose" ? `“${name}” vai ser sempre este produto` : `Escolha de “${name}” esquecida`);
          this._openCont(this._contMode.back ? { type: this._contMode.back } : null);
        });
      } else if (act === "find") {
        const q = (panel.querySelector(".cont-q").value || "").trim();
        if (q.length < 2) return;
        await busy(async () => {
          const r = await this._contCall("search_product", { query: q, limit: 8 });
          this._contSearch = { q, results: (r && r.results) || [] };
          this._renderCont();
        });
      } else if (act === "send") {
        await busy(async () => {
          const r = await this._contCall("send_to_basket", {});
          this._contResult = r || {};
          this._renderCont();
        });
      }
    });
    panel.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.classList.contains("cont-q")) {
        e.preventDefault();
        const b = panel.querySelector('[data-c="find"]');
        if (b) b.click();
      }
    });
  }

  _prodBtn(p, current) {
    const off = p.available === false;
    return `<button class="cont-prod${current ? " current" : ""}${off ? " off" : ""}" type="button" data-c="choose" data-sku="${esc(p.sku)}"${current ? " disabled" : ""}>
      <span class="cp-name">${esc(p.name)}${off ? " · esgotado" : ""}</span><span class="cp-price">${fmtEur(p.price ?? p.priceEur)}</span></button>`;
  }

  _renderCont() {
    const panel = this._$(".cont-panel");
    if (!panel) return;
    const mode = this._contMode;
    if (!mode || !this._contSensor()) { panel.hidden = true; panel.innerHTML = ""; return; }
    panel.hidden = false;
    const close = `<button class="cont-x" type="button" data-c="close" aria-label="Fechar">×</button>`;
    const items = this._contItems();

    if (mode.type === "pick") {
      const raw = this._findRaw(mode.uid);
      if (!raw) { panel.hidden = true; return; }
      const name = this._parse(raw).name;
      const c = items.get(mode.uid) || {};
      const cur = c.product;
      const seen = new Set(cur ? [cur.sku] : []);
      const alts = (c.alternatives || []).filter((a) => !seen.has(a.sku) && seen.add(a.sku));
      const found = this._contSearch ? this._contSearch.results.filter((a) => !seen.has(a.sku)) : [];
      const src = { escolhido: "escolhido por ti", habitual: "dos teus habituais", pesquisa: "pesquisa no catálogo" }[c.source] || "";
      panel.innerHTML = `
        <div class="cont-head"><b>Produto para “${esc(name)}”</b>${close}</div>
        ${cur ? `<div class="cont-sub">Atual${src ? ` (${src})` : ""}:</div>${this._prodBtn(cur, true)}` : `<div class="cont-sub">Ainda sem produto no Continente.</div>`}
        ${alts.length ? `<div class="cont-sub">Alternativas:</div>${alts.map((a) => this._prodBtn(a)).join("")}` : ""}
        <div class="cont-search">
          <input class="field cont-q" type="search" placeholder="Procurar no Continente…" value="${esc(this._contSearch ? this._contSearch.q : name)}" />
          <button class="toggle" type="button" data-c="find">Procurar</button>
        </div>
        ${this._contSearch ? (found.length ? found.map((a) => this._prodBtn(a)).join("") : `<div class="cont-sub">Nada encontrado.</div>`) : ""}
        <div class="cont-foot">
          ${mode.back ? `<button class="toggle" type="button" data-c="back">← Voltar</button>` : ""}
          ${c.source === "escolhido" ? `<button class="toggle" type="button" data-c="forget">Esquecer escolha</button>` : ""}
        </div>`;
      return;
    }

    // envio para o carrinho
    if (this._contResult) {
      const r = this._contResult;
      const added = r.added || [], failed = r.failed || [];
      const t = r.basket_totals || {};
      panel.innerHTML = `
        <div class="cont-head"><b>Carrinho do Continente</b>${close}</div>
        <div class="cont-ok">✓ ${added.length} produto${added.length === 1 ? "" : "s"} adicionado${added.length === 1 ? "" : "s"} ao carrinho</div>
        ${failed.length ? `<div class="cont-sub">Não foi possível: ${failed.map((f) => esc(f.name)).join(", ")}</div>` : ""}
        ${t.totalEur != null ? `<div class="cont-total"><span>Total do carrinho</span><b>${fmtEur(t.totalEur)}</b></div>` : ""}
        ${t.minOrderEur && t.totalEur < t.minOrderEur ? `<div class="cont-sub">Encomenda mínima: ${fmtEur(t.minOrderEur)}</div>` : ""}
        <div class="cont-sub">Revê e paga na app ou em <a href="https://www.continente.pt/checkout/carrinho/" target="_blank" rel="noopener">continente.pt</a>. Daqui nunca se fazem encomendas.</div>`;
      return;
    }
    const rows = this._allParsed().filter((i) => !i.done);
    let n = 0;
    const lines = rows.map((it) => {
      const c = items.get(it.uid);
      const p = c && c.product;
      if (p && p.available !== false) n += 1;
      return `<div class="cont-line${p ? (p.available === false ? " off" : "") : " missing"}">
        <span class="cl-item">${c ? c.qty : it.qty}× ${esc(it.name)}</span>
        <span class="cl-prod">${p ? esc(p.name) + (p.available === false ? " · esgotado" : "") : "não encontrado"}</span>
        <span class="cl-price">${p ? fmtEur(c.line_total) : ""}</span>
        <button class="cl-swap" type="button" data-c="swap" data-uid="${esc(it.uid)}">trocar</button>
      </div>`;
    }).join("");
    const total = this._contTotal();
    panel.innerHTML = `
      <div class="cont-head"><b>Enviar para o Continente</b>${close}</div>
      <div class="cont-lines">${lines || `<div class="cont-sub">Nada por comprar.</div>`}</div>
      ${total != null ? `<div class="cont-total"><span>Estimativa</span><b>${fmtEur(total)}</b></div>` : ""}
      <button class="add-btn cont-send" type="button" data-c="send"${n ? "" : " disabled"}>Adicionar ${n} ao carrinho</button>
      <div class="cont-sub">Os artigos esgotados ou não encontrados ficam de fora. Não faz encomendas.</div>`;
  }

  _rowHtml(it) {
    const uid = esc(it.uid);
    const showBadge = !this._groupByCategory || it.done;
    return `
      <div class="row${it.done ? " done" : ""}">
        <button class="check${it.done ? " done" : ""}" type="button" data-action="toggle" data-uid="${uid}"
             aria-label="${it.done ? "Voltar a pôr na lista" : "Marcar como comprado"}">${it.done ? "✓" : ""}</button>
        <div class="name" data-action="edit" data-uid="${uid}" title="Tocar para editar · manter premido e arrastar para mudar de categoria">${esc(it.name)}</div>
        ${showBadge ? this._catSelectHtml(it) : ""}
        ${it.done ? "" : this._priceHtml(it)}
        <div class="stepper">
          <button class="step" type="button" data-action="dec" data-uid="${uid}" aria-label="Menos">−</button>
          <span class="qty">${(this._qtyDraft && this._qtyDraft.get(it.uid)) || it.qty}</span>
          <button class="step" type="button" data-action="inc" data-uid="${uid}" aria-label="Mais">+</button>
        </div>
        <button class="del" type="button" data-action="delete" data-uid="${uid}" aria-label="Remover">×</button>
      </div>
    `;
  }
}

if (!customElements.get("shopping-list-plus-card")) {
  customElements.define("shopping-list-plus-card", ShoppingListPlusCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "shopping-list-plus-card",
    name: "Shopping List Plus",
    description: "Lista de compras com recomendações, categorias automáticas, quantidades e filtros, em cima de uma entidade todo.",
    preview: false,
    documentationURL: "https://github.com/PedroGrilo/shopping-list-plus-card",
  });
  console.info(`%c SHOPPING-LIST-PLUS-CARD %c v${VERSION} `,
    "color:#fff;background:#7B8CFF;border-radius:3px 0 0 3px;padding:2px 4px",
    "color:#7B8CFF;background:#222;border-radius:0 3px 3px 0;padding:2px 4px");
}
