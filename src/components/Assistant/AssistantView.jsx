import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sparkles,
  Settings2,
  Plus,
  History,
  Send,
  Square,
  Trash2,
  Loader2,
  Wrench,
  Globe,
  AlertCircle,
  KeyRound,
  Menu as MenuIcon,
  X,
} from 'lucide-react';
import Markdown from './Markdown';
import DeckProposal from './DeckProposal';
import AiSettingsModal from './AiSettingsModal';
import CopyButton from '../ui/CopyButton';
import { useStore } from '../../hooks/storeContext';
import { useCatalog } from '../../hooks/catalogContext';
import { useCollection } from '../../hooks/useCollection';
import { usePrices } from '../../hooks/usePrices';
import { loadAiSettings, saveAiSettings } from '../../ai/settings';
import { getModel, getUsageCost, addUsage, estimateTokens, formatUsd, EFFORTS } from '../../ai/models';
import { buildSystemPrompt, buildClipboardPrompt } from '../../ai/context';
import { createToolRunner, describeToolCall } from '../../ai/tools';
import {
  createClient,
  runTurn,
  describeError,
  listConversations,
  saveConversation,
  deleteConversation,
} from '../../ai/run';

const SUGGESTIONS = [
  'Quel est le meilleur deck que je peux monter avec mes cartes ?',
  'Analyse ma collection : forces, faiblesses, encres les mieux fournies.',
  "Propose-moi un deck Core compétitif et dis-moi ce qu'il me manque.",
  'Quelles cartes acheter en priorité pour compléter un deck fort ?',
  'Quelles synergies vois-tu entre mes cartes ?',
  'Quels doubles échanger, et contre quelles cartes utiles pour mes decks ?',
];

/** Text of a user message (plain string, or text blocks). */
const userText = (message) =>
  typeof message.content === 'string'
    ? message.content
    : message.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');

const isToolResults = (message) =>
  Array.isArray(message.content) && message.content.length > 0 && message.content.every((b) => b.type === 'tool_result');

const ToolChip = ({ icon: Icon = Wrench, children }) => (
  <div className="my-1.5 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.04] ring-1 ring-inset ring-white/10 text-xs text-slate-400">
    <Icon size={12} />
    {children}
  </div>
);

/** One assistant message: text, tool calls, deck proposals. */
const AssistantBlocks = ({ content, streaming }) => {
  const last = content.at(-1);
  return (
    <div>
      {content.map((block, i) => {
        if (block.type === 'text') return block.text ? <Markdown key={i} text={block.text} /> : null;
        if (block.type === 'tool_use' && block.name === 'propose_deck') {
          return streaming ? (
            <ToolChip key={i} icon={Sparkles}>
              Préparation d'un deck…
            </ToolChip>
          ) : (
            <DeckProposal key={i} input={block.input} />
          );
        }
        if (block.type === 'tool_use') return <ToolChip key={i}>{describeToolCall(block)}</ToolChip>;
        if (block.type === 'server_tool_use') {
          return (
            <ToolChip key={i} icon={Globe}>
              {describeToolCall(block)}
            </ToolChip>
          );
        }
        return null;
      })}
      {streaming && (!last || last.type === 'thinking' || last.type === 'redacted_thinking') && (
        <div className="flex items-center gap-2 text-xs text-slate-500 py-1">
          <Loader2 size={13} className="animate-spin" /> Réflexion…
        </div>
      )}
    </div>
  );
};

/** Binders and reference decks given to a new conversation, with the context size and cost. */
const ScopePicker = ({ binders, selected, onChange, includeReferences, onIncludeReferences, referenceCount, estimate, model }) => {
  const lorcana = binders.filter((b) => b.gameType === 'lorcana' && b.setCode);
  const price = getModel(model).price;
  const toggle = (id) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <div className="rounded-2xl bg-white/[0.02] ring-1 ring-inset ring-white/5 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-white">Cartes à analyser</span>
        <button
          onClick={() => onChange(selected.length === lorcana.length ? [] : lorcana.map((b) => b.id))}
          className="text-xs text-indigo-300 hover:text-white"
        >
          {selected.length === lorcana.length ? 'Aucune' : 'Toutes mes fardes'}
        </button>
      </div>
      {lorcana.length === 0 && <p className="text-xs text-slate-500">Aucune farde Lorcana : l'assistant n'analysera que le catalogue.</p>}
      <div className="flex flex-wrap gap-1.5">
        {lorcana.map((b) => {
          const on = selected.includes(b.id);
          return (
            <button
              key={b.id}
              onClick={() => toggle(b.id)}
              aria-pressed={on}
              className={`px-2.5 py-1 rounded-md text-xs ring-1 ring-inset transition-colors ${
                on ? 'bg-indigo-500/15 ring-indigo-400/60 text-white' : 'ring-white/10 text-slate-500 hover:text-white'
              }`}
            >
              {b.name}
            </button>
          );
        })}
      </div>
      {referenceCount > 0 ? (
        <label className="flex items-center gap-2.5 cursor-pointer select-none text-xs text-slate-400">
          <input
            type="checkbox"
            checked={includeReferences}
            onChange={(e) => onIncludeReferences(e.target.checked)}
            className="w-4 h-4 accent-indigo-500"
          />
          Inclure mes {referenceCount} deck{referenceCount > 1 ? 's' : ''} de référence (modèles à suivre)
        </label>
      ) : (
        <p className="text-xs text-slate-500">
          Astuce : ajoute des decks qui gagnent dans Decks → Decks de référence, l'assistant s'en inspirera.
        </p>
      )}
      <p className="text-[11px] text-slate-500">
        Contexte ≈ {estimate.toLocaleString('fr-BE')} tokens · ≈ {formatUsd((estimate * price.cacheWrite) / 1e6)} à la
        première question, puis ≈ {formatUsd((estimate * price.cacheRead) / 1e6)} par question (cache) + la réponse.
      </p>
    </div>
  );
};

const AssistantView = ({ onOpenSidebar }) => {
  const store = useStore();
  const { binders, decks, deckTags, allocations, prefs, view, setView } = store;
  const { index, loaded, total } = useCatalog();
  const prices = usePrices();
  const [settings, setSettings] = useState(loadAiSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [partial, setPartial] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [scope, setScope] = useState(() => binders.filter((b) => b.gameType === 'lorcana' && b.setCode).map((b) => b.id));
  const [includeReferences, setIncludeReferences] = useState(true);
  const seedDeck = view.deckId ? decks.find((d) => d.id === view.deckId) : null;
  // A request prepared by another screen (view.draft), or the improvement of a deck (view.deckId)
  const [draft, setDraft] = useState(
    () =>
      view.draft ??
      (seedDeck
        ? `Améliore mon deck « ${seedDeck.name} » (id ${seedDeck.id}) : rends-le plus régulier et compétitif avec mes cartes, explique tes changements puis propose la nouvelle liste.`
        : '')
  );
  const abortRef = useRef(null);
  const scrollRef = useRef(null);
  const textareaRef = useRef(null);

  const scopeIds = conversation?.scope.binderIds ?? scope;
  const collection = useCollection(scopeIds);
  const references = decks.filter((d) => d.kind === 'reference' && d.cards.length);

  const pendingSystem = useMemo(
    () =>
      !conversation && index
        ? buildSystemPrompt({
            binders: binders.filter((b) => scope.includes(b.id)),
            collection,
            decks,
            deckTags,
            index,
            includeReferences,
            lang: prefs.cardLanguage ?? 'fr',
          })
        : null,
    [conversation, index, binders, scope, collection, decks, deckTags, includeReferences, prefs.cardLanguage]
  );
  const estimate = pendingSystem ? estimateTokens(pendingSystem.map((b) => b.text).join('')) : 0;

  useEffect(() => {
    listConversations().then(setConversations);
  }, []);

  // Follow the answer while it streams
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [conversation?.messages.length, partial]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const updateSettings = (next) => {
    setSettings(next);
    saveAiSettings(next);
  };

  const startNew = () => {
    abortRef.current?.abort();
    setConversation(null);
    setPartial(null);
    setError(null);
    setHistoryOpen(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const openConversation = (c) => {
    abortRef.current?.abort();
    setConversation(c);
    setPartial(null);
    setError(null);
    setHistoryOpen(false);
  };

  const removeConversation = async (id) => {
    await deleteConversation(id);
    setConversations((list) => list.filter((c) => c.id !== id));
    if (conversation?.id === id) startNew();
  };

  const send = useCallback(
    async (text) => {
      const question = text.trim();
      if (!question || busy || !index || !settings.apiKey) return;
      setError(null);
      setDraft('');
      if (view.deckId || view.draft) setView({ kind: 'assistant' });

      const base =
        conversation ??
        {
          id: crypto.randomUUID(),
          title: question.slice(0, 80),
          createdAt: Date.now(),
          model: settings.model,
          effort: settings.effort,
          webSearch: settings.webSearch,
          scope: { binderIds: scope, includeReferences },
          system: pendingSystem,
          messages: [],
          usage: null,
          cost: 0,
        };
      let latest = [...base.messages, { role: 'user', content: question }];
      setConversation({ ...base, messages: latest });
      setBusy(true);

      const controller = new AbortController();
      abortRef.current = controller;
      const runTool = createToolRunner({ index, collection, decks, allocations, prices, tradeKeep: prefs.tradeKeep ?? 1 });
      let usage = null;
      let snapshot = null;
      try {
        const result = await runTurn({
          client: createClient(settings.apiKey),
          conversation: { ...base, messages: latest },
          runTool,
          signal: controller.signal,
          onUpdate: (messages, current) => {
            latest = messages;
            snapshot = current;
            setConversation((c) => (c ? { ...c, messages } : c));
            setPartial(current);
          },
        });
        latest = result.messages;
        usage = result.usage;
        if (result.stopReason === 'refusal') {
          setError(`Claude n'a pas répondu à cette demande${result.refusal ? ` : ${result.refusal}` : '.'}`);
        } else if (result.stopReason === 'max_tokens') {
          setError('Réponse coupée : elle dépassait la longueur maximale.');
        }
      } catch (err) {
        const message = describeError(err);
        if (message) setError(message);
        // Keep what was answered before the stop: complete steps, plus the visible text of the cut answer
        const cutText = snapshot?.content?.filter((b) => b.type === 'text' && b.text);
        if (cutText?.length) latest = [...latest, { role: 'assistant', content: cutText.map(({ type, text: t }) => ({ type, text: t })) }];
      } finally {
        setBusy(false);
        setPartial(null);
        abortRef.current = null;
      }

      const totalUsage = addUsage(base.usage, usage);
      const saved = {
        ...base,
        messages: latest,
        usage: totalUsage,
        cost: getUsageCost(totalUsage, base.model),
        updatedAt: Date.now(),
      };
      setConversation(saved);
      await saveConversation(saved);
      setConversations((list) => [saved, ...list.filter((c) => c.id !== saved.id)]);
    },
    [busy, index, settings, conversation, scope, includeReferences, pendingSystem, collection, decks, allocations, prices, prefs.tradeKeep, view.deckId, view.draft, setView]
  );

  const visible = conversation?.messages.filter((m) => !isToolResults(m)) ?? [];
  const model = getModel(conversation?.model ?? settings.model);
  const effortLabel = EFFORTS.find((e) => e.key === (conversation?.effort ?? settings.effort))?.label;

  return (
    <div className="flex flex-col h-full">
      <header className="px-4 sm:px-6 pt-4 pb-3 border-b border-white/5">
        <div className="flex items-center gap-2">
          <button onClick={onOpenSidebar} className="btn-icon lg:hidden -ml-2" aria-label="Ouvrir le menu">
            <MenuIcon size={20} />
          </button>
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center shadow-lg shadow-violet-500/30">
            <Sparkles size={16} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold text-white leading-tight truncate">{conversation?.title ?? 'Assistant IA'}</h1>
            <button onClick={() => setSettingsOpen(true)} className="text-[11px] text-slate-500 hover:text-slate-300">
              {model.label} · {effortLabel}
              {conversation?.cost ? ` · ${formatUsd(conversation.cost)}` : ''}
            </button>
          </div>
          <button onClick={() => setHistoryOpen((o) => !o)} className={`btn-icon xl:hidden ${historyOpen ? 'bg-white/10 text-white' : ''}`} aria-label="Historique" title="Historique">
            <History size={18} />
          </button>
          <button onClick={startNew} className="btn-secondary px-3 py-2" title="Nouvelle conversation">
            <Plus size={15} />
            <span className="hidden sm:inline">Nouvelle</span>
          </button>
          <button onClick={() => setSettingsOpen(true)} className="btn-icon" aria-label="Réglages" title="Réglages">
            <Settings2 size={18} />
          </button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0 relative">
        <aside
          className={`${
            historyOpen ? 'flex' : 'hidden'
          } xl:flex absolute xl:static inset-0 z-20 xl:z-auto w-full xl:w-64 flex-col bg-slate-950 xl:bg-transparent border-r border-white/5`}
        >
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Conversations</span>
            <button onClick={() => setHistoryOpen(false)} className="btn-icon p-1 xl:hidden" aria-label="Fermer">
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin px-2 pb-3 space-y-0.5">
            {conversations.length === 0 && <p className="px-2 text-xs text-slate-600">Aucune conversation.</p>}
            {conversations.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center rounded-lg transition-colors ${
                  conversation?.id === c.id ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'
                }`}
              >
                <button onClick={() => openConversation(c)} className="flex-1 min-w-0 text-left px-2.5 py-2">
                  <span className="block text-sm text-slate-300 truncate">{c.title}</span>
                  <span className="block text-[11px] text-slate-600">
                    {new Date(c.updatedAt).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' })} · {formatUsd(c.cost ?? 0)}
                  </span>
                </button>
                <button
                  onClick={() => removeConversation(c.id)}
                  className="btn-icon p-1.5 mr-1 opacity-0 group-hover:opacity-100 focus:opacity-100"
                  aria-label="Supprimer la conversation"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </aside>

        <section className="flex-1 flex flex-col min-w-0">
          <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin px-4 sm:px-6 py-5">
            <div className="max-w-3xl mx-auto space-y-5">
              {!settings.apiKey && (
                <div className="rounded-2xl bg-indigo-500/[0.07] ring-1 ring-inset ring-indigo-400/20 p-4 text-sm text-slate-300 leading-relaxed">
                  <p className="flex items-center gap-2 font-semibold text-white mb-1">
                    <KeyRound size={15} /> Ajoute ta clé API Anthropic
                  </p>
                  L'assistant appelle Claude directement depuis ce navigateur avec ta clé. Sans clé, tu peux copier ta
                  collection et ta question pour les coller dans Claude.ai.
                  <button onClick={() => setSettingsOpen(true)} className="btn-primary px-3 py-2 mt-3 flex">
                    Configurer
                  </button>
                </div>
              )}

              {!index && (
                <p className="flex items-center gap-2 text-sm text-slate-400">
                  <Loader2 size={15} className="animate-spin" /> Chargement du catalogue Lorcana ({loaded}/{total})…
                </p>
              )}

              {!conversation && index && (
                <>
                  <div className="text-center pt-4">
                    <h2 className="text-xl font-bold text-white">Que veux-tu construire ?</h2>
                    <p className="text-sm text-slate-500 mt-1">
                      L'assistant connaît les cartes des fardes choisies, tes decks et tes decks de référence.
                    </p>
                  </div>
                  <ScopePicker
                    binders={binders}
                    selected={scope}
                    onChange={setScope}
                    includeReferences={includeReferences}
                    onIncludeReferences={setIncludeReferences}
                    referenceCount={references.length}
                    estimate={estimate}
                    model={settings.model}
                  />
                  <div className="grid sm:grid-cols-2 gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => (settings.apiKey ? send(s) : setDraft(s))}
                        className="text-left text-sm text-slate-300 rounded-xl bg-white/[0.02] ring-1 ring-inset ring-white/5 hover:ring-white/20 hover:bg-white/[0.04] px-4 py-3 transition-colors"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {visible.map((message, i) =>
                message.role === 'user' ? (
                  <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-indigo-500/20 ring-1 ring-inset ring-indigo-400/20 px-4 py-2.5 text-sm text-white whitespace-pre-wrap">
                      {userText(message)}
                    </div>
                  </motion.div>
                ) : (
                  <AssistantBlocks key={i} content={message.content} />
                )
              )}
              {partial && <AssistantBlocks content={partial.content} streaming />}
              {busy && !partial && (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Loader2 size={13} className="animate-spin" /> Claude réfléchit…
                </div>
              )}

              <AnimatePresence>
                {error && (
                  <motion.p
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex gap-2 text-sm text-rose-300 rounded-xl bg-rose-500/[0.07] ring-1 ring-inset ring-rose-400/20 px-4 py-3"
                  >
                    <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          </div>

          <form
            className="px-4 sm:px-6 pb-4 pt-2"
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
          >
            <div className="max-w-3xl mx-auto">
              <div className="flex items-end gap-2 rounded-2xl bg-slate-950/60 ring-1 ring-inset ring-white/10 focus-within:ring-indigo-400/70 p-2">
                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send(draft);
                    }
                  }}
                  rows={Math.min(6, Math.max(1, draft.split('\n').length))}
                  placeholder={conversation ? 'Ta réponse…' : 'Demande un deck, une analyse…'}
                  className="flex-1 bg-transparent resize-none px-2 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none scrollbar-thin"
                  aria-label="Message à l'assistant"
                />
                {busy ? (
                  <button type="button" onClick={() => abortRef.current?.abort()} className="btn-secondary p-2.5" aria-label="Arrêter">
                    <Square size={15} />
                  </button>
                ) : (
                  <button type="submit" disabled={!draft.trim() || !settings.apiKey || !index} className="btn-primary p-2.5" aria-label="Envoyer">
                    <Send size={15} />
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between gap-3 mt-1.5 px-1">
                <span className="text-[11px] text-slate-600">Entrée pour envoyer · Maj+Entrée pour aller à la ligne</span>
                {(pendingSystem || conversation) && (
                  <CopyButton
                    text={buildClipboardPrompt(conversation?.system ?? pendingSystem, draft)}
                    label="Copier pour Claude.ai"
                    toast="Contexte copié : colle-le dans Claude.ai"
                    className="text-[11px] text-slate-500 hover:text-slate-300 inline-flex items-center gap-1"
                  />
                )}
              </div>
            </div>
          </form>
        </section>
      </div>

      <AiSettingsModal isOpen={settingsOpen} settings={settings} onSave={updateSettings} onClose={() => setSettingsOpen(false)} />
    </div>
  );
};

export default AssistantView;
