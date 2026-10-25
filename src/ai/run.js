import Anthropic from '@anthropic-ai/sdk';
import { TOOLS, WEB_SEARCH_TOOL } from './tools';
import { getModel, addUsage } from './models';
import { idbGetAll, idbSet, idbDelete } from '../utils/db';

const MAX_STEPS = 12;

export const createClient = (apiKey) =>
  // The key belongs to the user and stays in their browser: Folio has no server
  new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

/** Checks a key by reading the chosen model's description (no tokens billed). */
export const testApiKey = async (apiKey, model) => {
  await createClient(apiKey).models.retrieve(model);
};

/** French message for an API error. */
export const describeError = (error) => {
  if (error instanceof Anthropic.APIUserAbortError) return null;
  if (error instanceof Anthropic.AuthenticationError) return 'Clé API refusée : vérifie-la dans les réglages.';
  if (error instanceof Anthropic.PermissionDeniedError) return "Cette clé API n'a pas accès à ce modèle.";
  if (error instanceof Anthropic.RateLimitError) return 'Trop de requêtes pour le moment : réessaie dans un instant.';
  if (error instanceof Anthropic.APIConnectionError) return 'Connexion à Anthropic impossible : vérifie ta connexion.';
  if (error instanceof Anthropic.APIError) return `Erreur de l'API (${error.status ?? '?'}) : ${error.message}`;
  return error?.message ?? String(error);
};

/**
 * Runs one user turn: streams Claude's answer, runs the tools it calls in the browser and loops
 * until it is done. History is append-only (thinking blocks and cache prefixes depend on it).
 *
 * @param {object} params
 * @param {object} params.conversation { model, effort, webSearch, system, messages }
 * @param {(name: string, input: object) => string} params.runTool
 * @param {(messages: object[], partial: object|null) => void} params.onUpdate called while streaming
 * @param {AbortSignal} params.signal
 * @returns {Promise<{ messages: object[], usage: object, stopReason: string|null, refusal: string|null }>}
 */
export const runTurn = async ({ client, conversation, runTool, onUpdate, signal }) => {
  const { model, effort, webSearch, system } = conversation;
  let messages = conversation.messages;
  let usage = null;
  const fallback = getModel(model).fallback;
  const tools = webSearch ? [...TOOLS, WEB_SEARCH_TOOL] : TOOLS;

  for (let step = 0; step < MAX_STEPS; step++) {
    const stream = client.beta.messages.stream(
      {
        model,
        max_tokens: 64000,
        system,
        messages,
        tools,
        output_config: { effort },
        // Caches the whole prefix (instructions, collection, history) for the next turns
        cache_control: { type: 'ephemeral' },
        // On a safety decline, the API retries on another model instead of stopping
        ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
      },
      { signal }
    );
    stream.on('streamEvent', (_event, snapshot) => onUpdate(messages, snapshot));
    const message = await stream.finalMessage();
    usage = addUsage(usage, message.usage);
    messages = [...messages, { role: 'assistant', content: message.content }];
    onUpdate(messages, null);

    if (message.stop_reason === 'refusal') {
      return { messages, usage, stopReason: 'refusal', refusal: message.stop_details?.explanation ?? null };
    }
    // A server tool (web search) paused a long turn: send the history back to let it continue
    if (message.stop_reason === 'pause_turn') continue;
    if (message.stop_reason !== 'tool_use') return { messages, usage, stopReason: message.stop_reason, refusal: null };

    const results = message.content
      .filter((b) => b.type === 'tool_use')
      .map((block) => {
        try {
          return { type: 'tool_result', tool_use_id: block.id, content: runTool(block.name, block.input) };
        } catch (error) {
          return { type: 'tool_result', tool_use_id: block.id, content: `Erreur : ${error.message}`, is_error: true };
        }
      });
    // All results of one assistant turn go back together in a single user message
    messages = [...messages, { role: 'user', content: results }];
    onUpdate(messages, null);
  }
  return { messages, usage, stopReason: 'max_steps', refusal: null };
};

/* Conversations are kept in IndexedDB: their frozen system prompt holds the whole collection. */

export const listConversations = async () =>
  (await idbGetAll('conversations')).sort((a, b) => b.updatedAt - a.updatedAt);

export const saveConversation = (conversation) => idbSet('conversations', conversation.id, conversation);

export const deleteConversation = (id) => idbDelete('conversations', id);
