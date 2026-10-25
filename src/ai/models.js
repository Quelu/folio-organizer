/**
 * Claude models offered in the assistant, with their price per million tokens (USD).
 * cacheWrite is the 5-minute cache write price (1.25× input), cacheRead the cache hit price.
 * fallback: the model accepts the server-side refusal fallback ("default" mode).
 */
export const AI_MODELS = [
  {
    id: 'claude-opus-5-5',
    label: 'Claude Opus 5.5',
    hint: 'Le plus fin pour construire des decks',
    price: { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
    fallback: true,
  },
  {
    id: 'claude-sonnet-5-5',
    label: 'Claude Sonnet 5.5',
    hint: 'Rapide, environ 2× moins cher',
    price: { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
    fallback: true,
  },
  {
    id: 'claude-haiku-5-5',
    label: 'Claude Haiku 5.5',
    hint: 'Très économique, pour des questions simples',
    price: { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
    fallback: false,
  },
];

export const DEFAULT_MODEL = 'claude-opus-5-5';

export const EFFORTS = [
  { key: 'low', label: 'Rapide' },
  { key: 'medium', label: 'Équilibré' },
  { key: 'high', label: 'Approfondi' },
  { key: 'xhigh', label: 'Maximal' },
];

export const getModel = (id) => AI_MODELS.find((m) => m.id === id) ?? AI_MODELS[0];

/** Sum of two usage objects as the API returns them. */
export const addUsage = (a, b) => ({
  input_tokens: (a?.input_tokens ?? 0) + (b?.input_tokens ?? 0),
  output_tokens: (a?.output_tokens ?? 0) + (b?.output_tokens ?? 0),
  cache_creation_input_tokens: (a?.cache_creation_input_tokens ?? 0) + (b?.cache_creation_input_tokens ?? 0),
  cache_read_input_tokens: (a?.cache_read_input_tokens ?? 0) + (b?.cache_read_input_tokens ?? 0),
});

/** Cost in USD of a usage object on a model. */
export const getUsageCost = (usage, modelId) => {
  const { price } = getModel(modelId);
  return (
    ((usage?.input_tokens ?? 0) * price.input +
      (usage?.output_tokens ?? 0) * price.output +
      (usage?.cache_creation_input_tokens ?? 0) * price.cacheWrite +
      (usage?.cache_read_input_tokens ?? 0) * price.cacheRead) /
    1_000_000
  );
};

/** Rough token count for text (French / English mix), for estimates shown before sending. */
export const estimateTokens = (text) => Math.ceil(text.length / 3.6);

export const formatUsd = (value) =>
  new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'USD', maximumFractionDigits: value < 1 ? 3 : 2 }).format(value);
