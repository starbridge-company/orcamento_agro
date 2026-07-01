import { useState } from "react";
import { enviarCotacao, type CotacaoPayload } from "../api.ts";
import { ESTADOS, UNIDADES } from "../constants.ts";

interface ProdutoForm {
  id: string;
  material: string;
  quantidade: string;
  unidade: string;
  marca: string;
}

interface ProdutoErrors {
  material?: string;
  quantidade?: string;
  unidade?: string;
}

interface FormErrors {
  nome?: string;
  email?: string;
  cidade?: string;
  estado?: string;
  maxFornecedores?: string;
  raioKm?: string;
  produtos?: ProdutoErrors[];
}

type Status = "idle" | "submitting" | "success" | "error";

const novoProduto = (): ProdutoForm => ({
  id: crypto.randomUUID(),
  material: "",
  quantidade: "",
  unidade: "kg",
  marca: "",
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function QuoteForm() {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [cidade, setCidade] = useState("");
  const [estado, setEstado] = useState("");
  const [produtos, setProdutos] = useState<ProdutoForm[]>([novoProduto()]);
  const [maxFornecedores, setMaxFornecedores] = useState("8");
  const [abrangencia, setAbrangencia] = useState<"raio" | "brasil">("raio");
  const [raioKm, setRaioKm] = useState("100");
  const [errors, setErrors] = useState<FormErrors>({});
  const [status, setStatus] = useState<Status>("idle");
  const [feedback, setFeedback] = useState("");

  const updateProduto = (
    id: string,
    field: keyof Omit<ProdutoForm, "id">,
    value: string,
  ) => {
    setProdutos((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)),
    );
  };

  const addProduto = () => {
    setProdutos((prev) => [...prev, novoProduto()]);
  };

  const removeProduto = (id: string) => {
    setProdutos((prev) =>
      prev.length === 1 ? prev : prev.filter((p) => p.id !== id),
    );
  };

  const validate = (): FormErrors => {
    const next: FormErrors = {};
    if (!nome.trim()) next.nome = "Informe o nome";
    if (!email.trim()) next.email = "Informe o e-mail";
    else if (!EMAIL_RE.test(email.trim())) next.email = "E-mail inválido";
    if (!cidade.trim()) next.cidade = "Informe a cidade";
    if (!estado) next.estado = "Selecione o estado";

    const qtdForn = Number(maxFornecedores);
    if (!maxFornecedores.trim()) next.maxFornecedores = "Informe a quantidade";
    else if (!Number.isInteger(qtdForn) || qtdForn < 1 || qtdForn > 10)
      next.maxFornecedores = "Entre 1 e 10";

    if (abrangencia === "raio") {
      const r = Number(raioKm);
      if (!raioKm.trim()) next.raioKm = "Informe o raio";
      else if (!Number.isFinite(r) || r <= 0)
        next.raioKm = "Raio deve ser maior que zero";
    }

    const produtoErrors = produtos.map((p) => {
      const e: ProdutoErrors = {};
      if (!p.material.trim()) e.material = "Informe o material";
      const qtd = Number(p.quantidade);
      if (!p.quantidade.trim()) e.quantidade = "Informe a quantidade";
      else if (!Number.isFinite(qtd) || qtd <= 0)
        e.quantidade = "Quantidade deve ser maior que zero";
      if (!p.unidade.trim()) e.unidade = "Informe a unidade";
      return e;
    });
    if (produtoErrors.some((e) => Object.keys(e).length > 0)) {
      next.produtos = produtoErrors;
    }
    return next;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFeedback("");

    const validationErrors = validate();
    setErrors(validationErrors);
    const hasErrors =
      Object.keys(validationErrors).filter((k) => k !== "produtos").length > 0 ||
      (validationErrors.produtos?.some((e) => Object.keys(e).length > 0) ??
        false);
    if (hasErrors) {
      setStatus("error");
      setFeedback("Revise os campos destacados antes de enviar.");
      return;
    }

    const payload: CotacaoPayload = {
      nome: nome.trim(),
      email: email.trim(),
      cidade: cidade.trim(),
      estado,
      produtos: produtos.map((p) => {
        const marca = p.marca.trim();
        return {
          material: p.material.trim(),
          quantidade: Number(p.quantidade),
          unidade: p.unidade.trim(),
          ...(marca ? { marca } : {}),
        };
      }),
      maxFornecedores: Number(maxFornecedores),
      abrangencia,
      ...(abrangencia === "raio" ? { raioKm: Number(raioKm) } : {}),
    };

    setStatus("submitting");
    try {
      const { message } = await enviarCotacao(payload);
      setStatus("success");
      setFeedback(message);
      // limpa o formulário para uma nova cotação
      setNome("");
      setEmail("");
      setCidade("");
      setEstado("");
      setProdutos([novoProduto()]);
      setMaxFornecedores("8");
      setAbrangencia("raio");
      setRaioKm("100");
      setErrors({});
    } catch (err) {
      setStatus("error");
      setFeedback(
        err instanceof Error
          ? err.message
          : "Não foi possível enviar a cotação.",
      );
    }
  };

  const submitting = status === "submitting";

  return (
    <form className="panel" onSubmit={handleSubmit} noValidate>
      <div>
        <span className="kicker">Cotação</span>
        <h1 className="panel__title">Cotação de Insumos</h1>
        <p className="panel__subtitle">
          Preencha seus dados e os materiais desejados. Ao enviar, acionamos os
          fornecedores automaticamente.
        </p>
      </div>

      {/* ---- Dados do solicitante ---- */}
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">Seus dados</h2>
        </div>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="nome">Nome</label>
            <input
              id="nome"
              className="input"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="João Silva"
              aria-invalid={!!errors.nome}
            />
            {errors.nome && <span className="field-error">{errors.nome}</span>}
          </div>

          <div className="field">
            <label htmlFor="email">E-mail</label>
            <input
              id="email"
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="joao@gmail.com"
              aria-invalid={!!errors.email}
            />
            {errors.email && <span className="field-error">{errors.email}</span>}
          </div>

          <div className="field">
            <label htmlFor="cidade">Cidade</label>
            <input
              id="cidade"
              className="input"
              value={cidade}
              onChange={(e) => setCidade(e.target.value)}
              placeholder="São Paulo"
              aria-invalid={!!errors.cidade}
            />
            {errors.cidade && (
              <span className="field-error">{errors.cidade}</span>
            )}
          </div>

          <div className="field">
            <label htmlFor="estado">Estado</label>
            <select
              id="estado"
              className="select"
              value={estado}
              onChange={(e) => setEstado(e.target.value)}
              aria-invalid={!!errors.estado}
            >
              <option value="">Selecione a UF</option>
              {ESTADOS.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </select>
            {errors.estado && (
              <span className="field-error">{errors.estado}</span>
            )}
          </div>
        </div>
      </section>

      {/* ---- Produtos ---- */}
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">Produtos</h2>
          <button type="button" className="btn ghost" onClick={addProduto}>
            + Adicionar produto
          </button>
        </div>

        <div className="products">
          {produtos.map((produto, index) => {
            const pErr = errors.produtos?.[index] ?? {};
            return (
              <div className="product-card" key={produto.id}>
                <div className="product-card__head">
                  <span className="product-card__index">
                    Produto {index + 1}
                  </span>
                  {produtos.length > 1 && (
                    <button
                      type="button"
                      className="btn danger"
                      onClick={() => removeProduto(produto.id)}
                      aria-label={`Remover produto ${index + 1}`}
                    >
                      Remover
                    </button>
                  )}
                </div>

                <div className="field">
                  <label htmlFor={`material-${produto.id}`}>Material</label>
                  <input
                    id={`material-${produto.id}`}
                    className="input"
                    value={produto.material}
                    onChange={(e) =>
                      updateProduto(produto.id, "material", e.target.value)
                    }
                    placeholder="Ureia 45% N"
                    aria-invalid={!!pErr.material}
                  />
                  {pErr.material && (
                    <span className="field-error">{pErr.material}</span>
                  )}
                </div>

                <div className="product-grid">
                  <div className="field">
                    <label htmlFor={`quantidade-${produto.id}`}>
                      Quantidade
                    </label>
                    <input
                      id={`quantidade-${produto.id}`}
                      className="input"
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      value={produto.quantidade}
                      onChange={(e) =>
                        updateProduto(produto.id, "quantidade", e.target.value)
                      }
                      placeholder="50"
                      aria-invalid={!!pErr.quantidade}
                    />
                    {pErr.quantidade && (
                      <span className="field-error">{pErr.quantidade}</span>
                    )}
                  </div>

                  <div className="field">
                    <label htmlFor={`unidade-${produto.id}`}>Unidade</label>
                    <select
                      id={`unidade-${produto.id}`}
                      className="select"
                      value={produto.unidade}
                      onChange={(e) =>
                        updateProduto(produto.id, "unidade", e.target.value)
                      }
                      aria-invalid={!!pErr.unidade}
                    >
                      {UNIDADES.map((u) => (
                        <option key={u.value} value={u.value}>
                          {u.label}
                        </option>
                      ))}
                    </select>
                    {pErr.unidade && (
                      <span className="field-error">{pErr.unidade}</span>
                    )}
                  </div>

                  <div className="field">
                    <label htmlFor={`marca-${produto.id}`}>
                      Marca <span className="optional">(opcional)</span>
                    </label>
                    <input
                      id={`marca-${produto.id}`}
                      className="input"
                      value={produto.marca}
                      onChange={(e) =>
                        updateProduto(produto.id, "marca", e.target.value)
                      }
                      placeholder="Yara"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ---- Preferências da busca ---- */}
      <section className="section">
        <div className="section__head">
          <h2 className="section__title">Preferências da busca</h2>
        </div>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="maxFornecedores">
              Máximo de fornecedores a contatar (1–10)
            </label>
            <input
              id="maxFornecedores"
              className="input"
              type="number"
              min="1"
              max="10"
              step="1"
              inputMode="numeric"
              value={maxFornecedores}
              onChange={(e) => setMaxFornecedores(e.target.value)}
              aria-invalid={!!errors.maxFornecedores}
            />
            {errors.maxFornecedores && (
              <span className="field-error">{errors.maxFornecedores}</span>
            )}
          </div>

          <div className="field">
            <label htmlFor="abrangencia">Abrangência da busca</label>
            <select
              id="abrangencia"
              className="select"
              value={abrangencia}
              onChange={(e) =>
                setAbrangencia(e.target.value as "raio" | "brasil")
              }
            >
              <option value="raio">Raio (km)</option>
              <option value="brasil">Todo o Brasil</option>
            </select>
          </div>

          {abrangencia === "raio" && (
            <div className="field">
              <label htmlFor="raioKm">Raio máximo (km)</label>
              <input
                id="raioKm"
                className="input"
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={raioKm}
                onChange={(e) => setRaioKm(e.target.value)}
                placeholder="100"
                aria-invalid={!!errors.raioKm}
              />
              {errors.raioKm && (
                <span className="field-error">{errors.raioKm}</span>
              )}
            </div>
          )}
        </div>
      </section>

      {feedback && (
        <div
          className={`alert ${status === "success" ? "success" : "error"}`}
          role="status"
        >
          {feedback}
        </div>
      )}

      <div className="form-footer">
        <button
          type="submit"
          className="btn primary large"
          disabled={submitting}
        >
          {submitting && <span className="spinner" />}
          {submitting ? "Enviando..." : "Enviar cotação"}
        </button>
      </div>
    </form>
  );
}
