import { useState } from 'react';
import { KeyRound, Loader2, CheckCircle2, AlertCircle, ExternalLink, Trash2 } from 'lucide-react';
import Modal from '../ui/Modal';
import { AI_MODELS, EFFORTS } from '../../ai/models';
import { testApiKey, describeError } from '../../ai/run';

const CONSOLE_URL = 'https://console.anthropic.com/settings/keys';

const SettingsBody = ({ settings, onSave, onClose }) => {
  const [draft, setDraft] = useState(settings);
  const [test, setTest] = useState({ status: 'idle', message: '' });
  const set = (changes) => {
    setDraft((d) => ({ ...d, ...changes }));
    setTest({ status: 'idle', message: '' });
  };

  const runTest = async () => {
    setTest({ status: 'loading', message: '' });
    try {
      await testApiKey(draft.apiKey.trim(), draft.model);
      setTest({ status: 'ok', message: 'Clé valide, modèle disponible.' });
    } catch (error) {
      setTest({ status: 'error', message: describeError(error) });
    }
  };

  return (
    <form
      className="px-6 pb-6 pt-2 space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ ...draft, apiKey: draft.apiKey.trim() });
        onClose();
      }}
    >
      <div>
        <label className="label" htmlFor="ai-key">
          Clé API Anthropic
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              id="ai-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={draft.apiKey}
              onChange={(e) => set({ apiKey: e.target.value })}
              placeholder="sk-ant-…"
              className="field pl-9 font-mono"
            />
          </div>
          {draft.apiKey && (
            <button type="button" onClick={() => set({ apiKey: '' })} className="btn-icon" title="Effacer la clé" aria-label="Effacer la clé">
              <Trash2 size={16} />
            </button>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-2 leading-relaxed">
          La clé reste dans ce navigateur (jamais dans les sauvegardes) et n'est envoyée qu'à Anthropic. Les requêtes sont
          facturées sur ton compte.{' '}
          <a href={CONSOLE_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-indigo-300 hover:text-white">
            Créer une clé <ExternalLink size={11} />
          </a>
        </p>
      </div>

      <div>
        <span className="label">Modèle</span>
        <div className="space-y-1.5">
          {AI_MODELS.map((m) => (
            <label
              key={m.id}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg ring-1 ring-inset cursor-pointer transition-colors ${
                draft.model === m.id ? 'bg-indigo-500/15 ring-indigo-400/60' : 'ring-white/10 hover:bg-white/[0.03]'
              }`}
            >
              <input type="radio" name="ai-model" checked={draft.model === m.id} onChange={() => set({ model: m.id })} className="accent-indigo-500" />
              <span className="flex-1">
                <span className="block text-sm text-white">{m.label}</span>
                <span className="block text-xs text-slate-500">
                  {m.hint} · {m.price.input.toLocaleString('fr-BE')} $ / {m.price.output.toLocaleString('fr-BE')} $ par million de tokens
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <span className="label">Réflexion</span>
        <div className="flex gap-1.5 flex-wrap">
          {EFFORTS.map((e) => (
            <button
              key={e.key}
              type="button"
              onClick={() => set({ effort: e.key })}
              aria-pressed={draft.effort === e.key}
              className={`px-3 py-1.5 rounded-lg text-sm ring-1 ring-inset transition-colors ${
                draft.effort === e.key ? 'bg-indigo-500/15 ring-indigo-400/60 text-white' : 'ring-white/10 text-slate-400 hover:text-white'
              }`}
            >
              {e.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-2">Plus de réflexion donne de meilleurs decks, mais coûte plus et prend plus de temps.</p>
      </div>

      <label className="flex items-start gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={draft.webSearch}
          onChange={(e) => set({ webSearch: e.target.checked })}
          className="mt-0.5 w-4 h-4 accent-indigo-500"
        />
        <span className="text-sm text-slate-300">
          Recherche web
          <span className="block text-xs text-slate-500 mt-0.5">
            L'assistant peut chercher la méta actuelle et des résultats de tournois en ligne (recherches facturées en plus).
          </span>
        </span>
      </label>

      {test.status !== 'idle' && (
        <p
          className={`flex gap-2 text-xs ${
            test.status === 'ok' ? 'text-emerald-300' : test.status === 'error' ? 'text-rose-300' : 'text-slate-400'
          }`}
        >
          {test.status === 'loading' && <Loader2 size={14} className="animate-spin" />}
          {test.status === 'ok' && <CheckCircle2 size={14} />}
          {test.status === 'error' && <AlertCircle size={14} className="flex-shrink-0" />}
          {test.status === 'loading' ? 'Vérification…' : test.message}
        </p>
      )}

      <div className="flex gap-3">
        <button type="button" onClick={runTest} disabled={!draft.apiKey.trim() || test.status === 'loading'} className="btn-secondary flex-1">
          Tester la clé
        </button>
        <button type="submit" className="btn-primary flex-1">
          Enregistrer
        </button>
      </div>
    </form>
  );
};

const AiSettingsModal = ({ isOpen, settings, onSave, onClose }) => (
  <Modal isOpen={isOpen} onClose={onClose} title="Réglages de l'assistant IA">
    <SettingsBody settings={settings} onSave={onSave} onClose={onClose} />
  </Modal>
);

export default AiSettingsModal;
