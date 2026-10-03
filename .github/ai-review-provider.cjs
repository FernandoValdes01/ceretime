const MODEL = "deepseek/deepseek-v4.1-flash";
const PROVIDER = "OpenRouter";
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

function completionRequest(messages, outputTokens) {
  return {
    model: MODEL,
    temperature: 0.1,
    reasoning: { effort: "low" },
    max_tokens: outputTokens,
    response_format: { type: "json_object" },
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
module.exports = { MODEL, PROVIDER, ENDPOINT, completionRequest, addUsage, emptyUsage };
