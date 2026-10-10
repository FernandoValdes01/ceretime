const MODEL = "deepseek/deepseek-v4.1-flash";
const PROVIDER = "OpenRouter";
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

function completionRequest(messages, outputTokens) {
  return {
    model: MODEL,
    temperature: 0.1,
    reasoning: { enabled: false },
    max_tokens: outputTokens,
    response_format: { type: "json_object" },
    provider: { require_parameters: true },
    messages,
  };
}

function addUsage(usage, json) {
  if (
    !Number.isInteger(json.usage?.prompt_tokens) ||
    !Number.isInteger(json.usage?.completion_tokens) ||
    json.usage.prompt_tokens < 0 ||
    json.usage.completion_tokens < 0
  )
    return;
  usage.prompt += json.usage.prompt_tokens;
  usage.completion += json.usage.completion_tokens;
  usage.cachedPrompt += Math.max(
    0,
    Math.min(
      json.usage.prompt_tokens,
      Number(json.usage.prompt_tokens_details?.cached_tokens) || 0,
    ),
  );
  usage.measuredCalls++;
}

const emptyUsage = () => ({ prompt: 0, completion: 0, cachedPrompt: 0, measuredCalls: 0 });

// Reserve conservatively from UTF-8 bytes before the request, then settle with
// provider usage (cached input still counts as tokens). Unknown usage keeps its
// reservation, including failed requests whose consumption cannot be measured.
function tokenBudget(limit) {
  let spent = 0;
  const reservation = (body) => {
    const request = JSON.parse(body);
    return Buffer.byteLength(JSON.stringify(request.messages), "utf8") + request.max_tokens + 512;
  };
  return {
    get spent() {
      return spent;
    },
    canReserve(body, ceiling = limit) {
      return spent + reservation(body) <= Math.min(limit, ceiling);
    },
    reserve(body, ceiling = limit) {
      const reserved = reservation(body);
      if (spent + reserved > limit) throw new Error("Presupuesto total de tokens agotado.");
      if (spent + reserved > ceiling)
        throw new Error("Presupuesto de análisis agotado; se conserva reserva para verificar.");
      spent += reserved;
      let settled = false;
      return (json) => {
        if (settled) return;
        settled = true;
        const measured = emptyUsage();
        addUsage(measured, json);
        if (measured.measuredCalls) spent += measured.prompt + measured.completion - reserved;
      };
    },
  };
}
module.exports = {
  MODEL,
  PROVIDER,
  ENDPOINT,
  completionRequest,
  addUsage,
  emptyUsage,
  tokenBudget,
};
