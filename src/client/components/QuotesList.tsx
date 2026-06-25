import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listarCotacoes, type Cotacao, type ProdutoCotacao } from "../api.ts";
import { formatDate, formatQty } from "../format.ts";

type Status = "loading" | "ready" | "error";

/** Texto compacto de um material: "Ureia 45% N · 50 sc · Yara". */
function materialLabel(p: ProdutoCotacao): string {
  const qty = formatQty(p.quantity);
  const parts = [p.material];
  if (qty) parts.push(`${qty}${p.unit ? ` ${p.unit}` : ""}`);
  else if (p.unit) parts.push(p.unit);
  if (p.brand) parts.push(p.brand);
  return parts.join(" · ");
}

export function QuotesList() {
  const navigate = useNavigate();
  const [cotacoes, setCotacoes] = useState<Cotacao[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");

  const carregar = useCallback(async () => {
    setStatus("loading");
    setError("");
    try {
      const data = await listarCotacoes();
      setCotacoes(data);
      setStatus("ready");
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível carregar as cotações.",
      );
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  return (
    <section className="panel">
      <div className="section__head">
        <div>
          <span className="kicker">Cotações</span>
          <h1 className="panel__title">
            Cotações
            {status === "ready" && cotacoes.length > 0 && (
              <span className="count-pill">{cotacoes.length}</span>
            )}
          </h1>
          <p className="panel__subtitle">
            Clique em uma cotação para ver as respostas dos fornecedores.
          </p>
        </div>
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

      {status === "loading" && cotacoes.length === 0 && (
        <div className="table-empty">Carregando cotações…</div>
      )}

      {status === "ready" && cotacoes.length === 0 && (
        <div className="table-empty">Nenhuma cotação cadastrada ainda.</div>
      )}

      {cotacoes.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Cotação</th>
                <th>Solicitante</th>
                <th>Cidade</th>
                <th>Data</th>
                <th className="col-mats">Materiais</th>
                <th className="col-center">Respostas</th>
                <th aria-label="Abrir" />
              </tr>
            </thead>
            <tbody>
              {cotacoes.map((c) => (
                <tr
                  key={c.id}
                  className="clickable"
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/cotacoes/${c.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      navigate(`/cotacoes/${c.id}`);
                    }
                  }}
                >
                  <td>
                    <span className="quote-id">#{c.id}</span>
                  </td>
                  <td>
                    <span className="supplier-name">{c.buyer_name}</span>
                    <span className="supplier-city">{c.email}</span>
                  </td>
                  <td className="nowrap">
                    {c.city}
                    {c.state ? `/${c.state}` : ""}
                  </td>
                  <td className="nowrap">{formatDate(c.created_at)}</td>
                  <td className="col-mats">
                    {c.products.length > 0 ? (
                      <div className="mat-chips">
                        {c.products.map((p) => (
                          <span className="mat-chip" key={p.id}>
                            {materialLabel(p)}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="cell-empty">—</span>
                    )}
                  </td>
                  <td className="col-center">
                    <span
                      className={`count-badge ${
                        c.conversation_count > 0 ? "" : "count-badge--zero"
                      }`}
                    >
                      {c.conversation_count}
                    </span>
                  </td>
                  <td className="col-chevron" aria-hidden>
                    ›
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
