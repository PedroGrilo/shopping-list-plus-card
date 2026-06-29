
Claude terminou a resposta
conseguer fazer uma extensao para o homeassisant?

15/06

Mapeou tipos de extensões e ponderou qual esclarecer
Mapeou tipos de extensões e ponderou qual esclarecer
Sim, claro que dá! O Home Assistant é bastante aberto e há vários tipos de "extensão" que podes fazer, dependendo do que queres:

Custom Integration (componente em Python) — para ligar um dispositivo ou serviço que o HA ainda não suporta nativamente. É o que mexe com a parte de backend, entidades, etc.

Custom Card / Lovelace (frontend em JS/TS) — para criar um cartão personalizado no dashboard. Dado o teu lado de frontend, esta é provavelmente a mais divertida para ti. Há quem use Lit/web components.

Add-on (basicamente um container Docker) — uma app que corre ao lado do HA, tipo o que já fazes com o teu stack. Só funciona na versão HA OS / Supervised.

Blueprint (YAML) — automações reutilizáveis e partilháveis, sem código.

Para te dar a melhor ajuda, diz-me o que tens em mente:

P: Que tipo de extensão queres construir?
R: queria cirar uma lista de compras, mas tp bue personalizavel à minha maneira com filtros e cenas assim

15/06

Ponderou arquitetura entre integração customizada e card nativo
Ponderou arquitetura entre integração customizada e card nativo
Boa, lista de compras com filtros à tua maneira — perfeito para um custom card já que és forte no frontend. Deixa-me confirmar uns detalhes da API atual do HA antes de te dar código que não esteja desatualizado.


Ponderando o design de filtros personalizados
Ponderando o design de filtros personalizados
Agora os detalhes da entidade de lista (To-do) que vou usar como backend.


Architected tag-based shopping list card com filtros personalizados
Architected tag-based shopping list card com filtros personalizados
Perfeito — para isso o melhor é um custom card em cima da entidade nativa todo do HA (ex.: todo.shopping_list). Assim continuas a poder adicionar itens por voz/app nativa, mas tens uma UI à tua medida com filtros, pesquisa e agrupamento por cima.

A ideia-chave: o item nativo do todo só tem summary, status, description. Para teres "categorias" sem backend nenhum, uso uma convenção de tags com # no nome do item (ex.: Leite #laticínios #continente). O card faz parse, mostra o nome limpo + badges, e dá-te chips de filtro, pesquisa e agrupamento. Zero integração Python necessária.

Deixa-me construir-te uma v1 sólida.


Criou um arquivo, leu um arquivo
Criou um arquivo, leu um arquivo
Tens aqui a v1, pronta a instalar. É um web component vanilla (sem build, sem dependências externas — evita os problemas de import do lit via unpkg que andam a chatear malta nos fóruns).

O que faz:

Lê os itens da tua entidade todo em tempo real (subscrição WebSocket todo/item/subscribe, com fallback para todo/item/list).
Tags com # → categorias. Escreves Leite #laticínios #continente, o card mostra Leite + badges, e gera chips de filtro automaticamente.
Pesquisa, filtros multi-tag (OR), chip "sem categoria", agrupar por categoria e mostrar/esconder concluídos.
Toggle e remover por item; adicionar com Enter.
Guarda as tuas preferências de filtro em localStorage por entidade.
Usa as variáveis de tema do HA, por isso encaixa no teu tema; o accent_color deixa-te forçar uma cor (default = cor primária — mete lá o teu amarelo torrado se quiseres 😉).
Instalação (sem HACS):

Copia o ficheiro para config/www/shopping-list-plus-card.js.
Settings → Dashboards → ⋮ → Resources → adiciona /local/shopping-list-plus-card.js como JavaScript Module.
Refresh forçado (Ctrl/Cmd+Shift+R).
Adiciona o card:
yaml
type: custom:shopping-list-plus-card
entity: todo.shopping_list
title: Compras
accent_color: "#d99a2b"
group_by_category: false
show_completed: true
Confirma só o entity_id real da tua lista em Developer Tools → States (filtra por todo.).

Uns sítios óbvios para iterares a partir daqui, se te apetecer: editor visual de config (getConfigElement), guardar as tags no description em vez do summary (nome fica 100% limpo nas outras cards), quantidades (2x Leite), ou ordenar por loja. Diz qual destes te interessa e avanço.


Shopping list plus card
JS 
e com o hacs?

15/06

Investigou requisitos HACS para repositório de plugin
Investigou requisitos HACS para repositório de plugin
Boa pergunta — para o HACS o card tem de viver num repositório GitHub com uma estrutura específica. Deixa-me confirmar os requisitos atuais do HACS para plugins (que mudaram nos últimos tempos).


Synthesized HACS integration paths e scaffolded repo structure
Synthesized HACS integration paths e scaffolded repo structure
Com o HACS muda só o "empacotamento": o card passa a viver num repositório GitHub com a estrutura que o HACS reconhece. Como é para teu uso (estilo o resto do teu self-hosting), não precisas de submeter nada à loja oficial — adicionas como custom repository e está feito. Sem PRs nem reviews de meses.

Preparei-te os ficheiros do scaffold:


Criou 2 arquivos, leu um arquivo
Criou 2 arquivos, leu um arquivo
O essencial é a estrutura do repo. Para um card de um só ficheiro fica assim:

shopping-list-plus-card/        ← nome do repo (igual ao nome do ficheiro .js)
├── hacs.json
├── README.md
└── shopping-list-plus-card.js
Pontos importantes (confirmados na doc atual do HACS):

O hacs.json só precisa obrigatoriamente do name; o filename garante que o HACS apanha o ficheiro certo. Quando procura ficheiros, o HACS olha por esta ordem: a pasta dist, depois a raiz do repositório — para um único ficheiro, a raiz chega. 
HACS

Criar releases é recomendado: o HACS verifica o conteúdo da última release, e se houver várias o utilizador pode escolher entre as últimas 5 releases e o branch por defeito. Sem releases ele usa o branch por defeito, mas com tags (v1.0.0, etc.) tens versões e updates limpos. Faz git tag v1.0.0 && git push --tags ou cria a release pela UI do GitHub. 
HACS

Instalar no teu HA:

HACS → menu ⋮ → Custom repositories
URL do teu repo, tipo Dashboard → Add
Procura "Shopping List Plus Card" → Download
Hard refresh
Em storage mode (o normal), o HACS regista o recurso automaticamente como /hacsfiles/shopping-list-plus-card/shopping-list-plus-card.js com type: module. Só em YAML mode é que terias de o registar à mão. 
GitHub

Duas notas:

Se quiseres mesmo publicá-lo na loja pública do HACS (em vez de custom repo), aí sim há requisitos extra — pelo menos uma release, o hacs.json com name, repositório não arquivado, e imagens no README para o HACS renderizar — mais um backlog de review que demora. Para uso pessoal, ignora isto. 
HACS
Se mais tarde adicionares assets além do .js (ícones, locales), passa tudo para dist/, que é onde o HACS procura primeiro.
Queres que te prepare também o GitHub Action de validação do HACS (hacs/action) e um workflow para criar releases automáticas? É opcional, mas deixa o repo "à séria".


Hacs
Código · JSON 

Readme
Documento · MD 

Shopping list plus card
JS 
consegues alterar para ir sugerindo quando a pessoa esta a escrever o artigo, se tiver na lista, a pessoa selecionar logo aquele.
alem disso adiciona quantidades das coisas sff

15/06

Deliberando entre eliminar e recriar o ficheiro
Deliberando entre eliminar e recriar o ficheiro
Boas duas adições. Vou:

Sugestões enquanto escreves — o card passa a guardar um catálogo (em localStorage) de tudo o que já adicionaste. Ao escrever, aparece um dropdown: se o artigo já estiver na lista atual, sugere-o com um "→ +1" e selecionar incrementa a quantidade (em vez de duplicar); se só estiver no histórico, selecionar adiciona-o logo com as tags que costumas usar. Navega com ↑/↓, Enter e Esc.
Quantidades — stepper − N + em cada linha, e um campo de quantidade no add. Guardado como prefixo no nome (2x Leite #laticínios), por isso é visível em todo o lado e faz round-trip.
Vou reescrever o card com tudo integrado.


Verificou sintaxe JavaScript para erros
Verificou sintaxe JavaScript para erros
Vou só validar a sintaxe antes de te entregar.


Executou um comando, leu um arquivo
Executou um comando, leu um arquivo
Pronto, v1.1 entregue e com sintaxe validada.

Sugestões enquanto escreves: começas a escrever no campo de adicionar e aparece um dropdown. Primeiro mostra os artigos já na lista que dão match — com na lista · ×N → +1, e selecionar incrementa a quantidade desse (sem duplicar, exatamente o que pediste). A seguir mostra os do histórico (catálogo guardado em localStorage, ordenado por frequência) — selecionar adiciona logo com as tags que costumas usar. Funciona com ↑/↓, Enter e Esc, e também a clicar.

Quantidades: cada linha tem stepper − N + (atualiza via todo.update_item com rename), e há um campo de quantidade no add. Fica guardado como prefixo 2x  no nome, por isso aparece igual na app/voz e noutras cards. O cabeçalho agora mostra X artigos · Y unid. · Z no carrinho.

Notas rápidas:

O catálogo arranca vazio e vai-se construindo à medida que adicionas; na primeira carga também "semeia" com o que já lá tens, por isso esses ficam logo sugeríveis. É por dispositivo/browser (localStorage).
Quantidade é parseada como número inteiro com prefixo (2x, 3 ). Pesos tipo "500g" tratam-se como parte do nome — se quiseres unidades a sério (g/kg/L) com stepper próprio, dá para fazer, mas complica o parsing.
Se atualizaste via HACS, lembra-te de bumpar a tag (ex.: v1.1.0) e fazer re-download + hard refresh. Queres que adicione um editor visual de config (getConfigElement) para configurares isto tudo pela UI em vez de YAML?


Shopping list plus card
JS 
o quao dificil é meter um bot de whastapp para mandar um audio e adicoonar aqui ao home assisant?

15/06

Mapeando rotas oficiais e integrações do WhatsApp
Mapeando rotas oficiais e integrações do WhatsApp
Boa pergunta, e encaixa perfeitamente com a lista. Deixa-me confirmar o estado atual das peças (a parte do WhatsApp muda bastante) antes de te dar uma avaliação honesta.


Ponderou dificuldade, alternativas e integração com Home Assistant
Ponderou dificuldade, alternativas e integração com Home Assistant
Boa, e isto fecha o ciclo com a card. Resposta honesta: para ti, dificuldade média — dá para montar num fim de semana. O truque é que a parte difícil não é o Home Assistant nem a transcrição; é o WhatsApp em si.

Deixa-me mostrar-te o pipeline e onde mora a dificuldade.

V

Conectando a visualize...
Como vês, só uma caixa é vermelha — e é mesmo só essa que custa. Detalhe por etapa:

Receber o áudio (a parte chata). Não existe integração oficial de WhatsApp no HA, por isso há duas vias:

Cloud API oficial (Meta): legítima e estável, mas dá trabalho a montar — app no Meta for Developers, número, e um webhook público HTTPS para receber as mensagens. À escala pessoal o inbound não te custa nada. É a opção "sem risco".
Bridge não-oficial (Baileys/whatsapp-web.js, Green-API, ou integrações HACS como a ha-whatsapp). Põe-se de pé em minutos com um scan de QR code, mas o WhatsApp não permite bots nem clientes não-oficiais, por isso não é totalmente seguro e podes ser bloqueado. Usa um número secundário se fores por aqui. Nota que estas integrações precisam de uma app à parte com browser headless (Puppeteer/Playwright) para manter a sessão e a encriptação — ou seja, mais uma peça a correr. 
GitHub
Home Assistant
O resto é cola e coisas já resolvidas. O teu serviço (um webhook FastAPI, exatamente o que já fazes com o SpotSync) apanha o áudio, manda-o ao Whisper local (tens add-on Wyoming pronto a usar no HA), recebe o texto, e — bónus — passa-o a um LLM para o pôr no formato da tua card (compra dois pacotes de leite e pão → 2x Leite #laticínios + Pão #padaria). Depois é um todo.add_item via REST API. O HA já traz STT, pipeline Assist e agentes Anthropic/OpenAI nativos, por isso não tens de inventar essa parte.

E não estás a abrir caminho sozinho: já há quem tenha feito precisamente isto — um chatbot de WhatsApp/Signal/Telegram que transcreve e resume mensagens de voz e envia comandos para o Home Assistant sem expor o HA por VPN. 
Home Assistant

Veredicto: o pipeline em si é um fim de semana tranquilo para o teu nível. A decisão real é só uma — oficial (chato de montar, zero risco) vs não-oficial (rápido, risco de ban). Para brincar em casa, número secundário + bridge HACS; para algo a sério, Cloud API.

Queres que eu esboce a parte do webhook FastAPI (receber áudio → Whisper → LLM → todo.add_item)? É a peça que mais reaproveita o que já sabes.


title: Casa kiosk_mode: hide_header: false hide_sidebar: false button_card_templates: glass_tile: show_icon: true show_name: true show_label: true tap_action: action: toggle hold_action: action: more-info styles: card: - min-height: 116px

pasted

podes pff ajustar as cores se o home assisant tiver o tema branco sff

18/06

Diagnosticou incompatibilidade de cores em tema claro e formulou solução
Diagnosticou incompatibilidade de cores em tema claro e formulou solução
Percebo o problema, e a causa é simples: a card foi feita para herdar as variáveis de tema do HA (--divider-color, --secondary-background-color, etc.), por isso normalmente adapta-se sozinha. Mas tu forçaste um vidro escuro fixo no card_mod. Quando o HA está no tema claro, o tema passa a fornecer divisores escuros, fundos de campo claros e um fundo de dropdown branco — que deixam de combinar com o teu vidro escuro. Resultado: bordas que desaparecem, caixas claras no meio do escuro, e o dropdown de sugestões fica branco com texto claro por cima (ilegível).

A solução mais limpa (e sem re-download): fixar essas variáveis no teu card_mod, para a card usar sempre a paleta do vidro escuro, independentemente do tema do HA. Substitui o bloco da card de compras por isto:

yaml
- type: custom:shopping-list-plus-card
  entity: todo.lista_de_compras
  title: Compras
  accent_color: "#7B8CFF"   # combina com o roxo do resto do dashboard
  card_mod:
    style: |
      ha-card {
        border-radius: 30px !important;
        padding: 30px !important;
        background: rgba(255,255,255,0.055) !important;
        backdrop-filter: blur(22px) saturate(150%) !important;
        -webkit-backdrop-filter: blur(22px) saturate(150%) !important;
        border: 2px solid rgba(255,255,255,0.10) !important;
        box-shadow: 0 14px 36px rgba(0,0,0,0.32) !important;
        font-size: 1em !important;
        color: #F5F6FA !important;

        /* paleta fixa ao vidro escuro — não depende do tema do HA */
        --primary-text-color: #F5F6FA;
        --secondary-text-color: rgba(245,246,250,0.62);
        --divider-color: rgba(255,255,255,0.14);
        --secondary-background-color: rgba(255,255,255,0.06);
        --card-background-color: rgba(24,24,32,0.98);
        --text-primary-color: #ffffff;
      }
O que muda em relação ao teu: troquei o --secondary-text-color: white (duro demais para subtítulos/badges) por um cinza suave que combina com o resto, e adicionei o pin de --divider-color, --secondary-background-color, --card-background-color e --text-primary-color. O --card-background-color escuro é o que conserta o dropdown de sugestões no tema claro. O accent_color roxo faz os checks, chips, botão + e steppers brilharem no mesmo tom do dashboard.

Isto resolve o teu caso porque a tua view é sempre escura. Mas se quiseres a versão "à séria" para o HACS — em que a própria card deteta se está sobre fundo claro ou escuro e ajusta as bordas/fundos sozinha (para outros utilizadores que não tenham este card_mod) — eu meto essa auto-deteção no .js. Queres?

quero que seja possivel quando uma pessoa esta a escrever ter um input ao lado, do henero de um input com dropbox par aselecionar a categoria e senao houver a categoria,  cria-se uma nova. sem a logica do #

22:56

Validando campos de descrição e recursos suportados
Validando campos de descrição e recursos suportados
Boa ideia — fica muito mais limpo que andar a escrever #. Vou trocar o modelo: cada artigo passa a ter uma categoria escolhida num combobox ao lado, e a categoria fica guardada no campo description do item (em vez de #tag no nome), por isso o nome aparece limpo em todo o lado e o # desaparece. Se escreveres uma categoria que não existe, é criada na hora.

Só preciso de confirmar uma coisa técnica: que a tua lista suporta guardar description (e qual o bit certo para detetar isso), senão os adds rebentam.


Architected category dropdown with persistence, description support, and dynamic creation
Architected category dropdown with persistence, description support, and dynamic creation
Confirmado: a description é um campo real do item, e o HA valida contra o supported_features da lista — se eu enviar description a uma lista que não suporta, o add rebenta. A tua todo.lista_de_compras é uma Local To-do, que suporta (bit SET_DESCRIPTION_ON_ITEM = 64). Mesmo assim vou detetar isso e, em listas que não suportem, cair para um sufixo limpo [Categoria] em vez de #.

Vou reescrever a card (v1.2): novo modelo de uma categoria por artigo via combobox ao lado, sem #.


Executou 2 comandos, criou um arquivo, leu um arquivo
Executou 2 comandos, criou um arquivo, leu um arquivo
v1.2 entregue e validada. O que mudou:

Adeus #. Agora há um campo de Categoria ao lado do nome (à direita), com combobox próprio. Ao focares vês as categorias existentes; à medida que escreves, filtra. Se a categoria não existir, aparece em cima a opção Criar "…" em destaque — selecionar cria-a na hora e fica guardada para a próxima. Uma categoria por artigo.

Onde fica guardada. No campo description do item (a tua Local To-do suporta), por isso o nome aparece limpo na app nativa e em qualquer outra card. Detetei o supported_features: se algum dia usares uma lista que não suporte description, cai automaticamente para o sufixo [Categoria] no nome — nunca #.

O resto mantém-se e foi adaptado: sugestões enquanto escreves o nome (na lista → +1 na quantidade; do histórico → adiciona com a categoria que costumas usar), steppers de quantidade, chips de filtro (agora por categoria), agrupar e concluídos. Os chips fazem self-heal: se um filtro antigo apontar para uma categoria que já não existe, é limpo sozinho.

Notas de migração:

Artigos antigos com #tag no nome: a card lê o # como categoria (compat) e mostra o nome já sem o #. Mas só fica "convertido a sério" quando voltares a guardar o item — os antigos continuam com o # no summary em si.
A toggle de estado e a mudança de quantidade preservam a description, por isso a categoria não se perde.
Layout: em ecrã largo fica tudo numa linha (qtd · nome · categoria · +); no telemóvel quebra para baixo. Os dropdowns são posicionados por cima da lista, por isso não são cortados pela card.
Atualizaste via HACS? Bumpa a tag (v1.2.0), re-download e hard refresh.

Queres que a categoria de um artigo já na lista seja editável (ex.: tocar no badge para trocar de categoria)? Neste momento define-se na criação; editar depois implica um pequeno popover na linha.


Shopping list plus card
JS 

Claude Fable 5 está indisponível no momento.
Saiba mais(opens in new tab)




Claude é uma IA e pode cometer erros. Por favor, verifique as fontes citadas.
Shopping list plus card · JS
/**
 * Shopping List Plus Card  —  v1.2
 * Um custom card para o Home Assistant que assenta numa entidade `todo`
 * (ex.: todo.lista_de_compras) com pesquisa, filtros por categoria,
 * agrupamento, quantidades, sugestões e um seletor de categoria.
 *
 * Modelo de dados:
 *   - nome + quantidade ficam no `summary` (quantidade como prefixo "2x ")
 *   - categoria (uma por artigo) fica no campo `description` do item.
 *     Se a lista não suportar `description`, a categoria é guardada como
 *     sufixo "[Categoria]" no nome. Não há lógica de #.
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
 */
 
const TAG_RE = /#([\p{L}\p{N}_-]+)/gu;            // só para limpar legado
const QTY_RE = /^\s*(\d{1,3})\s*[x×*]?\s+/;        // prefixo de quantidade
const BRACKET_RE = /\s*\[([^\]]+)\]\s*$/;          // sufixo [Categoria] (fallback)
const FEAT_SET_DESCRIPTION = 64;                   // TodoListEntityFeature
 
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
    this._catalog = {};
    this._cats = new Set();
    this._seeded = false;
    this._suggestions = [];
    this._sugIndex = -1;
    this._catOptions = [];
    this._catIndex = -1;
  }
 
  /* ---------------- Lovelace lifecycle ---------------- */
 
  static getStubConfig() {
    return { entity: "todo.lista_de_compras", title: "Compras" };
  }
 
  setConfig(config) {
    if (!config.entity || !config.entity.startsWith("todo.")) {
      throw new Error("Define uma entidade `todo.` (ex.: todo.lista_de_compras)");
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
    this._loadCatalog();
    this._loadCats();
    this._buildChrome();
    this._applyAccent();
  }
 
  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    if (this._subscribedEntity !== this._config.entity) {
      this._teardown();
      this._subscribedEntity = this._config.entity;
      this._seeded = false;
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
    const onItems = (items) => {
      this._items = items || [];
      this._loaded = true;
      this._error = null;
      if (!this._seeded) { this._seed(); this._seeded = true; }
      this._renderDynamic();
    };
    try {
      const unsub = await this._hass.connection.subscribeMessage(
        (msg) => onItems(msg && msg.items),
        { type: "todo/item/subscribe", entity_id }
      );
      this._unsub = unsub;
    } catch (e) {
      try {
        const res = await this._hass.callWS({ type: "todo/item/list", entity_id });
        onItems(res && res.items);
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
 
  _supportsDescription() {
    const st = this._hass && this._hass.states[this._config.entity];
    const sf = st && st.attributes ? (st.attributes.supported_features | 0) : 0;
    return (sf & FEAT_SET_DESCRIPTION) === FEAT_SET_DESCRIPTION;
  }
 
  _callService(service, data) {
    return this._hass.callService("todo", service, data, {
      entity_id: this._config.entity,
    });
  }
 
  _addItem(rawName, qty, category) {
    let name = (rawName || "").trim();
    if (!name) return;
    qty = Math.max(1, parseInt(qty, 10) || 1);
    const cat = (category || "").trim();
    const hasPrefix = QTY_RE.test(name);
    let summary = qty > 1 && !hasPrefix ? `${qty}x ${name}` : name;
    const data = {};
    if (cat) {
      if (this._supportsDescription()) data.description = cat;
      else summary = `${summary} [${cat}]`;
    }
    data.item = summary;
    this._callService("add_item", data);
    this._catalogAdd(name, cat);
    if (cat) this._addCat(cat);
  }
 
  _toggleItem(uid, status) {
    this._callService("update_item", {
      item: uid,
      status: status === "completed" ? "needs_action" : "completed",
    });
  }
 
  _setQty(uid, summary, qty) {
    const stripped = (summary || "").replace(QTY_RE, "");
    const newSummary = qty > 1 ? `${qty}x ${stripped}` : stripped;
    this._callService("update_item", { item: uid, rename: newSummary });
  }
 
  _removeItem(uid) {
    this._callService("remove_item", { item: uid });
  }
 
  /* ---------------- Parsing ---------------- */
 
  _parse(item) {
    const summary = item.summary || "";
    let qty = 1;
    let rest = summary;
    const qm = summary.match(QTY_RE);
    if (qm) { qty = parseInt(qm[1], 10) || 1; rest = summary.slice(qm[0].length); }
 
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
 
    return {
      uid: item.uid,
      summary,
      name: name || rest || summary,
      category,
      qty,
      status: item.status,
      done: item.status === "completed",
    };
  }
 
  _allParsed() {
    return this._items.map((i) => this._parse(i));
  }
 
  _itemCats() {
    return [...new Set(this._allParsed().map((i) => i.category).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "pt"));
  }
 
  _matchesFilters(it) {
    if (!this._showCompleted && it.done) return false;
    if (this._search) {
      const q = this._search.toLowerCase();
      const inName = it.name.toLowerCase().includes(q);
      const inCat = it.category && it.category.toLowerCase().includes(q);
      if (!inName && !inCat) return false;
    }
    if (this._activeCats.size > 0) {
      const wantsUncat = this._activeCats.has("__uncat__");
      const catMatch = it.category && this._activeCats.has(it.category);
      const uncatMatch = wantsUncat && !it.category;
      if (!catMatch && !uncatMatch) return false;
    }
    return true;
  }
 
  /* ---------------- Catalog + categories ---------------- */
 
  _catalogKey() { return `slpc-catalog:${this._config.entity}`; }
  _catsKey() { return `slpc-cats:${this._config.entity}`; }
 
  _loadCatalog() {
    try {
      const r = window.localStorage.getItem(this._catalogKey());
      this._catalog = r ? JSON.parse(r) : {};
    } catch (_) { this._catalog = {}; }
  }
  _saveCatalog() {
    try { window.localStorage.setItem(this._catalogKey(), JSON.stringify(this._catalog)); } catch (_) {}
  }
  _loadCats() {
    try {
      const r = window.localStorage.getItem(this._catsKey());
      const a = r ? JSON.parse(r) : [];
      this._cats = new Set(Array.isArray(a) ? a : []);
    } catch (_) { this._cats = new Set(); }
  }
  _saveCats() {
    try { window.localStorage.setItem(this._catsKey(), JSON.stringify([...this._cats])); } catch (_) {}
  }
  _addCat(name) {
    const n = (name || "").trim();
    if (!n) return;
    if (![...this._cats].some((c) => c.toLowerCase() === n.toLowerCase())) {
      this._cats.add(n);
      this._saveCats();
    }
  }
 
  _catalogAdd(name, category) {
    const key = name.trim().toLowerCase();
    if (!key) return;
    const prev = this._catalog[key] || { count: 0 };
    this._catalog[key] = {
      name: name.trim(),
      category: (category || "").trim(),
      count: (prev.count || 0) + 1,
      last: Date.now(),
    };
    this._saveCatalog();
  }
 
  _seed() {
    let changed = false;
    for (const it of this._allParsed()) {
      const key = it.name.toLowerCase();
      if (!this._catalog[key]) {
        this._catalog[key] = { name: it.name, category: it.category || "", count: 0, last: 0 };
        changed = true;
      }
      if (it.category) this._addCat(it.category);
    }
    if (changed) this._saveCatalog();
  }
 
  _knownCats() {
    const map = new Map(); // lower -> display
    const add = (c) => {
      const n = (c || "").trim();
      if (n && !map.has(n.toLowerCase())) map.set(n.toLowerCase(), n);
    };
    this._cats.forEach(add);
    this._allParsed().forEach((it) => add(it.category));
    Object.values(this._catalog).forEach((c) => add(c.category));
    return [...map.values()].sort((a, b) => a.localeCompare(b, "pt"));
  }
 
  _computeSuggestions(text) {
    const q = (text || "").trim().toLowerCase();
    if (q.length < 1) return [];
    const out = [];
    const seen = new Set();
    for (const it of this._allParsed()) {
      if (it.done) continue;
      if (it.name.toLowerCase().includes(q)) {
        out.push({ kind: "list", uid: it.uid, name: it.name, category: it.category, qty: it.qty, summary: it.summary });
        seen.add(it.name.toLowerCase());
      }
    }
    const cat = Object.values(this._catalog)
      .filter((c) => c.name.toLowerCase().includes(q) && !seen.has(c.name.toLowerCase()))
      .sort((a, b) => (b.count - a.count) || (b.last - a.last));
    for (const c of cat) {
      out.push({ kind: "catalog", name: c.name, category: c.category || "" });
      seen.add(c.name.toLowerCase());
    }
    return out.slice(0, 6);
  }
 
  _computeCatOptions(text) {
    const raw = (text || "").trim();
    const q = raw.toLowerCase();
    const all = this._knownCats();
    const filtered = q ? all.filter((c) => c.toLowerCase().includes(q)) : all;
    const out = filtered.map((c) => ({ name: c, create: false }));
    if (q && !all.some((c) => c.toLowerCase() === q)) {
      out.unshift({ name: raw, create: true });
    }
    return out.slice(0, 8);
  }
 
  /* ---------------- Preferences ---------------- */
 
  _prefsKey() { return `slpc:${this._config.entity}`; }
  _loadPrefs() {
    try {
      const raw = window.localStorage.getItem(this._prefsKey());
      if (!raw) return;
      const p = JSON.parse(raw);
      if (Array.isArray(p.activeCats)) this._activeCats = new Set(p.activeCats);
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
  }
 
  _buildChrome() {
    if (this._chromeBuilt) {
      const t = this.shadowRoot.querySelector(".title");
      if (t) t.textContent = this._config.title;
      return;
    }
    this.shadowRoot.innerHTML = `
      <style>
        :host { --slpc-accent: var(--primary-color); --slpc-radius: 12px; }
        ha-card { padding: 16px; }
        .header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
        .title { font-size: 1.3rem; font-weight: 600; color: var(--primary-text-color); letter-spacing: -0.01em; }
        .counts { font-size: 0.8rem; color: var(--secondary-text-color); white-space: nowrap; }
        .counts b { color: var(--slpc-accent); }
 
        .add-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-start; margin-bottom: 12px; }
        input.field {
          background: var(--secondary-background-color, rgba(127,127,127,0.1));
          border: 1px solid var(--divider-color, rgba(127,127,127,0.2));
          color: var(--primary-text-color);
          border-radius: var(--slpc-radius); padding: 10px 14px; font-size: 0.95rem;
          outline: none; transition: border-color 0.15s;
        }
        input.field:focus { border-color: var(--slpc-accent); }
        .qty-input { flex: 0 0 54px; width: 54px; text-align: center; padding: 10px 6px; }
        .combo { position: relative; }
        .name-wrap { flex: 2 1 150px; }
        .cat-wrap { flex: 1 1 120px; }
        .add-input, .cat-input { width: 100%; box-sizing: border-box; }
        .add-btn {
          flex: 0 0 auto; border: none; cursor: pointer; height: 42px;
          background: var(--slpc-accent); color: var(--text-primary-color, #fff);
          border-radius: var(--slpc-radius); padding: 0 16px; font-size: 1.3rem; line-height: 1; font-weight: 500;
        }
        .add-btn:active { transform: translateY(1px); }
 
        .dropdown {
          position: absolute; left: 0; right: 0; top: calc(100% + 6px); z-index: 40;
          max-height: 264px; overflow: auto; display: none;
          border: 1px solid var(--divider-color, rgba(127,127,127,0.25));
          border-radius: var(--slpc-radius);
          background: var(--card-background-color, var(--ha-card-background, var(--primary-background-color)));
          box-shadow: 0 12px 28px rgba(0,0,0,0.35);
        }
        .opt { display: flex; align-items: center; gap: 8px; padding: 9px 12px; cursor: pointer; }
        .opt:hover, .opt.hi { background: var(--secondary-background-color, rgba(127,127,127,0.12)); }
        .opt-name { color: var(--primary-text-color); font-size: 0.92rem; }
        .opt-meta { margin-left: auto; font-size: 0.7rem; color: var(--secondary-text-color); white-space: nowrap; }
        .opt.create .opt-name { color: var(--slpc-accent); }
 
        .search-input { width: 100%; box-sizing: border-box; margin-bottom: 10px; }
        .toolbar { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
        .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
        .chip {
          cursor: pointer; user-select: none;
          border: 1px solid var(--divider-color, rgba(127,127,127,0.3));
          background: transparent; color: var(--secondary-text-color);
          border-radius: 999px; padding: 4px 12px; font-size: 0.8rem; transition: all 0.12s;
        }
        .chip:hover { border-color: var(--slpc-accent); }
        .chip.active { background: var(--slpc-accent); border-color: var(--slpc-accent); color: var(--text-primary-color, #fff); }
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
          border-bottom: 1px solid var(--divider-color, rgba(127,127,127,0.15)); padding-bottom: 4px;
        }
        .row { display: flex; align-items: center; gap: 10px; padding: 9px 4px; border-radius: 8px; }
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
        .stepper { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; }
        .step {
          cursor: pointer; border: 1px solid var(--divider-color, rgba(127,127,127,0.3));
          background: transparent; color: var(--secondary-text-color);
          border-radius: 6px; width: 24px; height: 24px; line-height: 1; font-size: 1rem; padding: 0;
          transition: all 0.12s;
        }
        .step:hover { border-color: var(--slpc-accent); color: var(--slpc-accent); }
        .qty { min-width: 18px; text-align: center; font-size: 0.9rem; color: var(--primary-text-color); }
        .row.done .stepper, .row.done .qty { opacity: 0.55; }
        .del {
          flex: 0 0 auto; cursor: pointer; border: none; background: none;
          color: var(--secondary-text-color); font-size: 1.1rem; opacity: 0; padding: 2px 6px;
          transition: opacity 0.12s, color 0.12s;
        }
        .row:hover .del { opacity: 0.6; }
        .del:hover { color: var(--error-color, #db4437); opacity: 1; }
        .empty, .msg { text-align: center; color: var(--secondary-text-color); padding: 28px 12px; font-size: 0.9rem; }
      </style>
      <ha-card>
        <div class="header">
          <span class="title"></span>
          <span class="counts"></span>
        </div>
        <div class="add-row">
          <input class="field qty-input" type="number" min="1" value="1" title="Quantidade" />
          <div class="combo name-wrap">
            <input class="field add-input" type="text" autocomplete="off" placeholder="Adicionar artigo…" />
            <div class="dropdown suggestions"></div>
          </div>
          <div class="combo cat-wrap">
            <input class="field cat-input" type="text" autocomplete="off" placeholder="Categoria" />
            <div class="dropdown cat-dropdown"></div>
          </div>
          <button class="add-btn" title="Adicionar">+</button>
        </div>
        <input class="field search-input" type="text" placeholder="Procurar…" />
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
    const catInput = $(".cat-input");
    const qtyInput = $(".qty-input");
 
    const commit = () => {
      this._addItem(addInput.value, qtyInput.value, catInput.value);
      addInput.value = "";
      catInput.value = "";
      qtyInput.value = 1;
      this._closeSuggestions();
      this._closeCatOptions();
      addInput.focus();
    };
 
    $(".add-btn").addEventListener("click", commit);
 
    /* --- name field: item suggestions --- */
    addInput.addEventListener("input", (e) => {
      this._suggestions = this._computeSuggestions(e.target.value);
      this._sugIndex = -1;
      this._renderSuggestions();
    });
    addInput.addEventListener("keydown", (e) => {
      const n = this._suggestions.length;
      if (e.key === "ArrowDown" && n) { e.preventDefault(); this._sugIndex = (this._sugIndex + 1) % n; this._renderSuggestions(); }
      else if (e.key === "ArrowUp" && n) { e.preventDefault(); this._sugIndex = (this._sugIndex - 1 + n) % n; this._renderSuggestions(); }
      else if (e.key === "Enter") {
        if (this._sugIndex >= 0) { e.preventDefault(); this._activateSuggestion(this._sugIndex); }
        else commit();
      } else if (e.key === "Escape") { this._closeSuggestions(); }
    });
    addInput.addEventListener("blur", () => setTimeout(() => this._closeSuggestions(), 150));
    $(".suggestions").addEventListener("mousedown", (e) => {
      const el = e.target.closest(".opt");
      if (!el) return;
      e.preventDefault();
      this._activateSuggestion(parseInt(el.dataset.i, 10));
    });
 
    /* --- category field: combobox --- */
    const openCat = () => {
      this._catOptions = this._computeCatOptions(catInput.value);
      this._catIndex = -1;
      this._renderCatOptions();
    };
    catInput.addEventListener("focus", openCat);
    catInput.addEventListener("input", openCat);
    catInput.addEventListener("keydown", (e) => {
      const n = this._catOptions.length;
      if (e.key === "ArrowDown" && n) { e.preventDefault(); this._catIndex = (this._catIndex + 1) % n; this._renderCatOptions(); }
      else if (e.key === "ArrowUp" && n) { e.preventDefault(); this._catIndex = (this._catIndex - 1 + n) % n; this._renderCatOptions(); }
      else if (e.key === "Enter") {
        if (this._catIndex >= 0) { e.preventDefault(); this._activateCatOption(this._catIndex); }
        else commit();
      } else if (e.key === "Escape") { this._closeCatOptions(); }
    });
    catInput.addEventListener("blur", () => setTimeout(() => this._closeCatOptions(), 150));
    $(".cat-dropdown").addEventListener("mousedown", (e) => {
      const el = e.target.closest(".opt");
      if (!el) return;
      e.preventDefault();
      this._activateCatOption(parseInt(el.dataset.i, 10));
    });
 
    /* --- search --- */
    $(".search-input").addEventListener("input", (e) => {
      this._search = e.target.value;
      this._renderList();
    });
 
    /* --- toggles --- */
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
 
    /* --- list actions --- */
    $(".list").addEventListener("click", (e) => {
      const el = e.target.closest("[data-action]");
      if (!el) return;
      const uid = el.dataset.uid;
      const action = el.dataset.action;
      if (action === "toggle") this._toggleItem(uid, el.dataset.status);
      else if (action === "delete") this._removeItem(uid);
      else if (action === "inc" || action === "dec") {
        const raw = this._items.find((x) => x.uid === uid);
        if (!raw) return;
        const p = this._parse(raw);
        const nq = action === "inc" ? p.qty + 1 : Math.max(1, p.qty - 1);
        if (nq !== p.qty) this._setQty(uid, raw.summary, nq);
      }
    });
 
    /* --- chips --- */
    $(".chips").addEventListener("click", (e) => {
      const el = e.target.closest(".chip");
      if (!el) return;
      const cat = el.dataset.cat;
      if (this._activeCats.has(cat)) this._activeCats.delete(cat);
      else this._activeCats.add(cat);
      this._savePrefs();
      this._renderDynamic();
    });
 
    this._chromeBuilt = true;
  }
 
  /* ---------------- Activation helpers ---------------- */
 
  _activateSuggestion(i) {
    const s = this._suggestions[i];
    if (!s) return;
    const addInput = this.shadowRoot.querySelector(".add-input");
    const catInput = this.shadowRoot.querySelector(".cat-input");
    const qtyInput = this.shadowRoot.querySelector(".qty-input");
    if (s.kind === "list") {
      this._setQty(s.uid, s.summary, (s.qty || 1) + 1);
    } else {
      this._addItem(s.name, qtyInput.value, s.category || "");
    }
    addInput.value = "";
    catInput.value = "";
    qtyInput.value = 1;
    this._closeSuggestions();
    this._closeCatOptions();
    addInput.focus();
  }
 
  _closeSuggestions() {
    this._suggestions = [];
    this._sugIndex = -1;
    this._renderSuggestions();
  }
 
  _activateCatOption(i) {
    const o = this._catOptions[i];
    if (!o) return;
    const catInput = this.shadowRoot.querySelector(".cat-input");
    catInput.value = o.name;
    this._closeCatOptions();
    catInput.focus();
  }
 
  _closeCatOptions() {
    this._catOptions = [];
    this._catIndex = -1;
    this._renderCatOptions();
  }
 
  /* ---------------- Dynamic rendering ---------------- */
 
  _renderDynamic() {
    if (!this._chromeBuilt) return;
    this._renderChips();
    this._renderList();
    this._renderCounts();
  }
 
  _renderCounts() {
    const parsed = this._allParsed();
    const units = parsed.filter((i) => !i.done).reduce((n, i) => n + i.qty, 0);
    const lines = parsed.filter((i) => !i.done).length;
    const done = parsed.filter((i) => i.done).length;
    this.shadowRoot.querySelector(".counts").innerHTML =
      `<b>${lines}</b> artigos · ${units} unid. · ${done} no carrinho`;
  }
 
  _renderSuggestions() {
    const box = this.shadowRoot.querySelector(".suggestions");
    const sugs = this._suggestions;
    if (!sugs.length) { box.innerHTML = ""; box.style.display = "none"; return; }
    box.style.display = "block";
    box.innerHTML = sugs.map((s, i) => {
      const badge = s.category ? `<span class="badge">${esc(s.category)}</span>` : "";
      const meta = s.kind === "list"
        ? `<span class="opt-meta">na lista · ×${s.qty} → +1</span>`
        : `<span class="opt-meta">adicionar</span>`;
      return `<div class="opt${i === this._sugIndex ? " hi" : ""}" data-i="${i}">
        <span class="opt-name">${esc(s.name)}</span>${badge}${meta}</div>`;
    }).join("");
  }
 
  _renderCatOptions() {
    const box = this.shadowRoot.querySelector(".cat-dropdown");
    const opts = this._catOptions;
    if (!opts.length) { box.innerHTML = ""; box.style.display = "none"; return; }
    box.style.display = "block";
    box.innerHTML = opts.map((o, i) => {
      if (o.create) {
        return `<div class="opt create${i === this._catIndex ? " hi" : ""}" data-i="${i}">
          <span class="opt-name">Criar “${esc(o.name)}”</span>
          <span class="opt-meta">nova categoria</span></div>`;
      }
      return `<div class="opt${i === this._catIndex ? " hi" : ""}" data-i="${i}">
        <span class="opt-name">${esc(o.name)}</span></div>`;
    }).join("");
  }
 
  _renderChips() {
    const cats = this._itemCats();
    const hasUncat = this._allParsed().some((i) => !i.category);
 
    // self-heal: drop active filters that no longer exist
    const valid = new Set(cats);
    valid.add("__uncat__");
    let pruned = false;
    for (const c of [...this._activeCats]) if (!valid.has(c)) { this._activeCats.delete(c); pruned = true; }
    if (pruned) this._savePrefs();
 
    const parts = [];
    for (const c of cats) {
      const active = this._activeCats.has(c) ? " active" : "";
      parts.push(`<span class="chip${active}" data-cat="${esc(c)}">${esc(c)}</span>`);
    }
    if (hasUncat) {
      const active = this._activeCats.has("__uncat__") ? " active" : "";
      parts.push(`<span class="chip${active}" data-cat="__uncat__">sem categoria</span>`);
    }
    this.shadowRoot.querySelector(".chips").innerHTML = parts.join("");
  }
 
  _renderList() {
    const list = this.shadowRoot.querySelector(".list");
    if (this._error) {
      list.innerHTML = `<div class="msg">Erro ao ler a lista: ${esc(String(this._error.message || this._error))}</div>`;
      return;
    }
    if (!this._loaded) { list.innerHTML = `<div class="msg">A carregar…</div>`; return; }
 
    const visible = this._allParsed().filter((i) => this._matchesFilters(i));
    if (visible.length === 0) { list.innerHTML = `<div class="empty">Nada por aqui. 🛒</div>`; return; }
 
    if (this._groupByCategory) list.innerHTML = this._renderGrouped(visible);
    else {
      const sorted = [...visible].sort((a, b) => Number(a.done) - Number(b.done));
      list.innerHTML = sorted.map((i) => this._rowHtml(i)).join("");
    }
  }
 
  _renderGrouped(items) {
    const groups = new Map();
    for (const it of items) {
      const key = it.category || "sem categoria";
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
    const badge = it.category ? `<span class="badge">${esc(it.category)}</span>` : "";
    return `
      <div class="row${it.done ? " done" : ""}">
        <div class="check${it.done ? " done" : ""}" data-action="toggle"
             data-uid="${esc(it.uid)}" data-status="${esc(it.status)}">${it.done ? "✓" : ""}</div>
        <div class="name">${esc(it.name)}</div>
        <div class="badges">${badge}</div>
        <div class="stepper">
          <button class="step" data-action="dec" data-uid="${esc(it.uid)}" title="Menos">−</button>
          <span class="qty">${it.qty}</span>
          <button class="step" data-action="inc" data-uid="${esc(it.uid)}" title="Mais">+</button>
        </div>
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
  description: "Lista de compras com seletor de categoria, sugestões, quantidades e filtros, em cima de uma entidade todo.",
  preview: false,
  documentationURL: "https://developers.home-assistant.io/docs/frontend/custom-ui/custom-card",
});
 
console.info("%c SHOPPING-LIST-PLUS-CARD %c v1.2 ",
  "color:#fff;background:#7B8CFF;border-radius:3px 0 0 3px;padding:2px 4px",
  "color:#7B8CFF;background:#222;border-radius:0 3px 3px 0;padding:2px 4px");
 
