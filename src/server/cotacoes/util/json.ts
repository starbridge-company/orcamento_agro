/**
 * Extrai o primeiro array/objeto JSON de uma string que pode vir com markdown
 * (```json ... ```) ou texto ao redor. Usado para "limpar" respostas de LLMs
 * (Perplexity, OpenAI) antes do JSON.parse. Retorna null se não achar JSON.
 */
export function extractJson(str: string): unknown {
  if (!str) return null;
  const s = str
    .replace(/```json\s*/gi, "")
    .replace(/```javascript\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  const startArr = s.indexOf("[");
  const startObj = s.indexOf("{");
  let start = -1;
  let endChar = "";
  if (startArr !== -1 && (startObj === -1 || startArr < startObj)) {
    start = startArr;
    endChar = "]";
  } else if (startObj !== -1) {
    start = startObj;
    endChar = "}";
  }
  if (start === -1) return null;

  const end = s.lastIndexOf(endChar);
  if (end <= start) return null;

  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}
