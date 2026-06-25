import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Link, useMatch, useNavigate, useParams } from "react-router-dom";
import {
  atualizarResponsavel,
  listarConversas,
  listarMensagens,
  obterCotacao,
  type Conversa,
  type Cotacao,
  type Mensagem,
  type Responsavel,
} from "../api.ts";
import {
  formatDate,
  formatDayLabel,
  formatQty,
  formatTime,
} from "../format.ts";

type Status = "loading" | "ready" | "error";

/** Mapeia o status textual para uma variante de cor do badge. */
function statusVariant(status: string): "wait" | "ok" | "warn" | "neutral" {
  const s = status.toLowerCase();
  if (s.includes("aguardando") || s.includes("pendente")) return "wait";
  if (s.includes("respond") || s.includes("propost") || s.includes("conclu"))
    return "ok";
  if (s.includes("recus") || s.includes("cancel") || s.includes("sem"))
    return "warn";
  return "neutral";
}

/** Humaniza uma chave de metadata: "data_entrega" -> "Data entrega". */
function humanizeKey(key: string): string {
  const spaced = key.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Converte um valor arbitrário de metadata em texto legível. */
function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) return value.map(renderValue).join(", ");
  return JSON.stringify(value);
}

/** Exibe o metadata (JSONB) como uma lista estruturada de chave/valor. */
function MetadataCell({ metadata }: { metadata: Conversa["metadata"] }) {
  const entries = useMemo(
    () =>
      metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? Object.entries(metadata)
        : [],
    [metadata],
  );

  if (entries.length === 0) return <span className="cell-empty">—</span>;

  return (
    <dl className="meta-list">
      {entries.map(([key, value]) => (
        <div className="meta-list__row" key={key}>
          <dt className="meta-list__key">{humanizeKey(key)}</dt>
          <dd className="meta-list__value">{renderValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Célula de texto simples com fallback para vazio. */
function Cell({ value }: { value: string | number | null }) {
  if (value === null || value === "" || value === undefined)
    return <span className="cell-empty">—</span>;
  return <>{value}</>;
}

interface PopoverCoords {
  top: number;
  left: number;
  placement: "top" | "bottom";
}

/**
 * Prévia da mensagem (2 linhas) que, ao passar o mouse / receber foco, abre um
 * pop-up personalizado com o corpo inteiro. O pop-up é renderizado via portal
 * em `position: fixed` para não ser cortado pelo overflow da tabela.
 */
function MessagePreview({ text }: { text: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | null>(null);
  const [coords, setCoords] = useState<PopoverCoords | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const open = useCallback(() => {
    cancelClose();
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const POPUP_W = 380;
    const margin = 12;

    let left = r.left;
    if (left + POPUP_W > window.innerWidth - margin) {
      left = window.innerWidth - margin - POPUP_W;
    }
    if (left < margin) left = margin;

    const spaceBelow = window.innerHeight - r.bottom;
    const placement: PopoverCoords["placement"] =
      spaceBelow < 240 ? "top" : "bottom";
    const top = placement === "bottom" ? r.bottom + 8 : r.top - 8;

    setCoords({ top, left, placement });
  }, [cancelClose]);

  // Fecha com um pequeno atraso, dando tempo de mover o mouse do gatilho
  // para o pop-up (que cancela o fechamento ao receber o mouse).
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setCoords(null), 140);
  }, [cancelClose]);

  useEffect(() => cancelClose, [cancelClose]);

  return (
    <>
      <button
        ref={ref}
        type="button"
        className="msg-preview"
        onMouseEnter={open}
        onMouseLeave={scheduleClose}
        onFocus={open}
        onBlur={scheduleClose}
        aria-label="Ver mensagem inicial completa"
      >
        {text}
      </button>
      {coords &&
        createPortal(
          <div
            className={`msg-popover msg-popover--${coords.placement}`}
            style={{
              top: coords.top,
              left: coords.left,
              transform:
                coords.placement === "top" ? "translateY(-100%)" : undefined,
            }}
            role="tooltip"
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
            <span className="msg-popover__head">Mensagem inicial</span>
            <p className="msg-popover__body">{text}</p>
          </div>,
          document.body,
        )}
    </>
  );
}

interface MenuPos {
  top: number;
  left: number;
  width: number;
}

const RESPONSAVEIS: Responsavel[] = ["Agente", "Humano"];

/**
 * Dropdown personalizado do responsável (substitui o <select> nativo).
 * O menu é renderizado via portal em `position: fixed` para não ser cortado
 * pelo overflow da tabela; fecha ao clicar fora ou pressionar Esc.
 */
function ResponsibleSelect({
  value,
  saving,
  onChange,
}: {
  value: Responsavel;
  saving: boolean;
  onChange: (value: Responsavel) => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const open = pos !== null;

  const toggle = useCallback(() => {
    setPos((prev) => {
      if (prev) return null;
      const el = btnRef.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.bottom + 6, left: r.left, width: Math.max(r.width, 150) };
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setPos(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPos(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const variant = value === "Humano" ? "humano" : "agente";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`resp-select resp-select--${variant}`}
        onClick={toggle}
        disabled={saving}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Responsável pela conversa"
      >
        {saving ? (
          <span className="spinner spinner--dark" />
        ) : (
          <span className="resp-dot" />
        )}
        {value}
        <span className="resp-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            className="resp-menu"
            role="listbox"
            style={{ top: pos.top, left: pos.left, minWidth: pos.width }}
          >
            {RESPONSAVEIS.map((opt) => (
              <button
                key={opt}
                type="button"
                role="option"
                aria-selected={opt === value}
                className={`resp-menu__item resp-menu__item--${
                  opt === "Humano" ? "humano" : "agente"
                } ${opt === value ? "is-active" : ""}`}
                onClick={() => {
                  setPos(null);
                  if (opt !== value) onChange(opt);
                }}
              >
                <span className="resp-dot" />
                {opt}
                {opt === value && (
                  <span className="resp-check" aria-hidden>
                    ✓
                  </span>
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

function ChatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Rótulo legível do autor de uma mensagem. */
function authorLabel(author: string): string {
  switch (author) {
    case "supplier":
      return "Fornecedor";
    case "system":
      return "Agente";
    case "buyer":
      return "Comprador";
    default:
      return author;
  }
}

/** Mensagens do fornecedor chegam à esquerda; as nossas vão à direita. */
function isIncoming(author: string): boolean {
  return author === "supplier";
}

/** Renderiza o corpo de uma mensagem conforme o tipo (texto/mídia). */
function MessageBody({ m }: { m: Mensagem }) {
  const type = (m.message_type ?? "text").toLowerCase();

  if (m.media_url) {
    if (type === "image") {
      return (
        <span className="chat-media-wrap">
          <img className="chat-media" src={m.media_url} alt={m.content ?? "Imagem"} />
          {m.content && <span className="chat-caption">{m.content}</span>}
        </span>
      );
    }
    if (type === "audio") {
      return <audio className="chat-audio" controls src={m.media_url} />;
    }
    if (type === "video") {
      return <video className="chat-media" controls src={m.media_url} />;
    }
    return (
      <a
        className="chat-doc"
        href={m.media_url}
        target="_blank"
        rel="noreferrer"
      >
        📎 {m.content ?? "Abrir documento"}
      </a>
    );
  }

  if (m.content) return <span className="chat-text">{m.content}</span>;
  return <span className="chat-text chat-text--muted">[mensagem sem conteúdo]</span>;
}

/**
 * Chat (estilo WhatsApp/Telegram) com todas as mensagens de uma conversa.
 * Drawer lateral em portal; somente leitura para acompanhar o agente.
 */
function ConversationChat({
  conversa,
  onClose,
}: {
  conversa: Conversa;
  onClose: () => void;
}) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async () => {
    setStatus("loading");
    setError("");
    try {
      const data = await listarMensagens(conversa.id);
      setMensagens(data);
      setStatus("ready");
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível carregar as mensagens.",
      );
    }
  }, [conversa.id]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Fecha com Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Rola para a última mensagem ao carregar.
  useEffect(() => {
    if (status === "ready" && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [status, mensagens.length]);

  const iniciais = (conversa.supplier_name ?? "?")
    .trim()
    .slice(0, 2)
    .toUpperCase();

  let ultimoDia = "";

  return createPortal(
    <div className="chat-overlay" onClick={onClose}>
      <div
        className="chat-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Conversa com ${conversa.supplier_name ?? "fornecedor"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="chat-header">
          <span className="chat-avatar">{iniciais}</span>
          <div className="chat-header__info">
            <span className="chat-header__name">
              {conversa.supplier_name ?? "Fornecedor"}
            </span>
            <span className="chat-header__sub">
              {conversa.phone ??
                conversa.supplier_city ??
                `Disparo ${conversa.dispatch_number}`}
            </span>
          </div>
          <button
            type="button"
            className="chat-close"
            onClick={onClose}
            aria-label="Fechar chat"
          >
            ×
          </button>
        </header>

        <div className="chat-body" ref={bodyRef}>
          {status === "loading" && (
            <div className="chat-state">Carregando mensagens…</div>
          )}
          {status === "error" && (
            <div className="chat-state chat-state--error">{error}</div>
          )}
          {status === "ready" && mensagens.length === 0 && (
            <div className="chat-state">
              Nenhuma mensagem nesta conversa ainda.
            </div>
          )}
          {status === "ready" &&
            mensagens.map((m) => {
              const ts = m.sent_at ?? m.created_at;
              const dia = formatDate(ts);
              const mostrarSeparador = dia !== ultimoDia;
              ultimoDia = dia;
              const incoming = isIncoming(m.author);
              return (
                <Fragment key={m.id}>
                  {mostrarSeparador && (
                    <div className="chat-daysep">
                      <span>{formatDayLabel(ts)}</span>
                    </div>
                  )}
                  <div
                    className={`chat-msg ${
                      incoming ? "chat-msg--in" : "chat-msg--out"
                    }`}
                  >
                    <div className="chat-bubble">
                      <span className="chat-author">
                        {authorLabel(m.author)}
                      </span>
                      <MessageBody m={m} />
                      <span className="chat-time">{formatTime(ts)}</span>
                    </div>
                  </div>
                </Fragment>
              );
            })}
        </div>

        <footer className="chat-footer">
          <span className="chat-footer__note">
            Somente leitura · acompanhe a conversa do agente
          </span>
          <button
            type="button"
            className="btn ghost"
            onClick={carregar}
            disabled={status === "loading"}
          >
            {status === "loading" && <span className="spinner spinner--dark" />}
            Atualizar
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

export function QuoteConversations() {
  const { id } = useParams();
  const navigate = useNavigate();
  const quoteId = Number(id);

  // O chat é derivado da URL (/cotacoes/:id/chat/:conversaId) via splat na
  // mesma rota, então o componente NÃO remonta ao abrir/fechar o chat.
  const chatMatch = useMatch("/cotacoes/:id/chat/:conversaId");
  const conversaId = chatMatch?.params.conversaId;

  const [quote, setQuote] = useState<Cotacao | null>(null);
  const [quoteStatus, setQuoteStatus] = useState<Status>("loading");
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<number | null>(null);

  // O id (BIGINT) chega como string do backend; compare como string.
  const chat = conversaId
    ? conversas.find((c) => String(c.id) === conversaId) ?? null
    : null;

  // Atualização otimista do responsável; reverte se a API falhar.
  const alterarResponsavel = useCallback(
    async (conversa: Conversa, value: Responsavel) => {
      if (value === conversa.responsible) return;
      const anterior = conversa.responsible;
      setConversas((prev) =>
        prev.map((c) =>
          c.id === conversa.id ? { ...c, responsible: value } : c,
        ),
      );
      setSavingId(conversa.id);
      setError("");
      try {
        await atualizarResponsavel(conversa.id, value);
      } catch (err) {
        setConversas((prev) =>
          prev.map((c) =>
            c.id === conversa.id ? { ...c, responsible: anterior } : c,
          ),
        );
        setError(
          err instanceof Error
            ? err.message
            : "Não foi possível salvar o responsável.",
        );
      } finally {
        setSavingId(null);
      }
    },
    [],
  );

  const carregar = useCallback(async () => {
    setStatus("loading");
    setError("");
    try {
      const data = await listarConversas(quoteId);
      setConversas(data);
      setStatus("ready");
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível carregar as respostas.",
      );
    }
  }, [quoteId]);

  const carregarCotacao = useCallback(async () => {
    setQuoteStatus("loading");
    try {
      const q = await obterCotacao(quoteId);
      setQuote(q);
      setQuoteStatus("ready");
    } catch {
      setQuoteStatus("error");
    }
  }, [quoteId]);

  useEffect(() => {
    if (!Number.isInteger(quoteId)) return;
    carregarCotacao();
    carregar();
  }, [quoteId, carregarCotacao, carregar]);

  if (!Number.isInteger(quoteId)) {
    return (
      <section className="panel">
        <Link to="/cotacoes" className="back-link">
          ← Voltar para cotações
        </Link>
        <div className="table-empty">Cotação inválida.</div>
      </section>
    );
  }

  if (quoteStatus === "ready" && !quote) {
    return (
      <section className="panel">
        <Link to="/cotacoes" className="back-link">
          ← Voltar para cotações
        </Link>
        <div className="table-empty">Cotação #{quoteId} não encontrada.</div>
      </section>
    );
  }

  return (
    <section className="panel">
      <Link to="/cotacoes" className="back-link">
        ← Voltar para cotações
      </Link>

      <div className="quote-summary">
        <span className="kicker">Cotação #{quoteId}</span>
        {quote ? (
          <>
            <h1 className="panel__title">{quote.buyer_name}</h1>
            <div className="quote-summary__meta">
              <span>{quote.email}</span>
              <span className="dot">·</span>
              <span>
                {quote.city}
                {quote.state ? `/${quote.state}` : ""}
              </span>
              <span className="dot">·</span>
              <span>{formatDate(quote.created_at)}</span>
            </div>
            {quote.products.length > 0 && (
              <div className="mat-chips">
                {quote.products.map((p) => {
                  const qty = formatQty(p.quantity);
                  return (
                    <span className="mat-chip" key={p.id}>
                      {p.material}
                      {qty && (
                        <span className="mat-chip__qty">
                          {qty}
                          {p.unit ? ` ${p.unit}` : ""}
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <h1 className="panel__title">Carregando cotação…</h1>
        )}
      </div>

      <div className="section__head">
        <h2 className="section__title">
          Respostas dos fornecedores
          {status === "ready" && conversas.length > 0 && (
            <span className="count-pill">{conversas.length}</span>
          )}
        </h2>
        <button
          type="button"
          className="btn ghost"
          onClick={carregar}
          disabled={status === "loading"}
        >
          {status === "loading" && <span className="spinner spinner--dark" />}
          Atualizar
        </button>
      </div>

      {status === "error" && (
        <div className="alert error" role="status">
          {error}
        </div>
      )}

      {status === "loading" && conversas.length === 0 && (
        <div className="table-empty">Carregando respostas…</div>
      )}

      {status === "ready" && conversas.length === 0 && (
        <div className="table-empty">
          Nenhum fornecedor respondeu a esta cotação ainda.
        </div>
      )}

      {conversas.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th className="col-chat" aria-label="Conversa" />
                <th>Responsável</th>
                <th className="col-center">Disparo</th>
                <th>Fornecedor</th>
                <th>Telefone</th>
                <th>Status</th>
                <th className="col-msg">Mensagem inicial</th>
                <th>Prazo</th>
                <th>Pagamento</th>
                <th>Frete</th>
                <th>Impostos</th>
                <th>Volume</th>
                <th>Validade</th>
                <th className="col-meta">Observações / especificações</th>
              </tr>
            </thead>
            <tbody>
              {conversas.map((c) => (
                <tr
                  key={c.id}
                  className="clickable"
                  onClick={() => navigate(`/cotacoes/${quoteId}/chat/${c.id}`)}
                >
                  <td
                    className="col-chat"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="chat-open-btn"
                      onClick={() =>
                        navigate(`/cotacoes/${quoteId}/chat/${c.id}`)
                      }
                      aria-label={`Abrir conversa com ${
                        c.supplier_name ?? "fornecedor"
                      }`}
                    >
                      <ChatIcon />
                      <span className="chat-open-btn__tip" role="tooltip">
                        Abrir conversa
                      </span>
                    </button>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <ResponsibleSelect
                      value={c.responsible}
                      saving={savingId === c.id}
                      onChange={(v) => alterarResponsavel(c, v)}
                    />
                  </td>
                  <td className="col-center num">{c.dispatch_number}</td>
                  <td>
                    <span className="supplier-name">
                      <Cell value={c.supplier_name} />
                    </span>
                    {c.supplier_city && (
                      <span className="supplier-city">{c.supplier_city}</span>
                    )}
                  </td>
                  <td className="nowrap">
                    <Cell value={c.phone} />
                  </td>
                  <td>
                    <span className={`badge badge--${statusVariant(c.status)}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="col-msg">
                    {c.initial_message ? (
                      <MessagePreview text={c.initial_message} />
                    ) : (
                      <span className="cell-empty">—</span>
                    )}
                  </td>
                  <td>
                    <Cell value={c.delivery_time} />
                  </td>
                  <td>
                    <Cell value={c.payment_method} />
                  </td>
                  <td>
                    <Cell value={c.shipping} />
                  </td>
                  <td>
                    <Cell value={c.taxes} />
                  </td>
                  <td>
                    <Cell value={c.volume} />
                  </td>
                  <td>
                    <Cell value={c.proposal_validity} />
                  </td>
                  <td className="col-meta">
                    <MetadataCell metadata={c.metadata} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {chat && (
        <ConversationChat
          conversa={chat}
          onClose={() => navigate(`/cotacoes/${quoteId}`)}
        />
      )}
    </section>
  );
}
