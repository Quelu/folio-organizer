import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Tag, Plus, X, Check, Settings2, ChevronUp, ChevronDown, Trash2 } from 'lucide-react';
import Modal from '../ui/Modal';
import { useStore } from '../../hooks/storeContext';
import { useToast } from '../ui/toastContext';
import { TAG_COLORS, findTagByName, getDeckTags, searchTags } from '../../utils/deckTags';

/** A tag in its color. onRemove adds a cross that takes it off. */
export const TagChip = ({ tag, onRemove, className = '' }) => (
  <span
    className={`inline-flex items-center gap-1 max-w-[10rem] px-1.5 py-px rounded-md text-[11px] font-medium ${className}`}
    style={{ color: tag.color, background: `${tag.color}1f`, boxShadow: `inset 0 0 0 1px ${tag.color}40` }}
  >
    <span className="truncate">{tag.name}</span>
    {onRemove && (
      <button
        type="button"
        onClick={onRemove}
        className="-mr-0.5 rounded opacity-60 hover:opacity-100"
        aria-label={`Retirer le tag ${tag.name}`}
      >
        <X size={11} />
      </button>
    )}
  </span>
);

/** A deck's tags, and a popover to put tags on it, create new ones or open their management. */
export const DeckTagPicker = ({ deck }) => {
  const { deckTags, updateDeck, createDeckTag } = useStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [manageOpen, setManageOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const tagIds = deck.tags ?? [];
  const setTagIds = (tags) => updateDeck(deck.id, { tags });
  const toggle = (tagId) => setTagIds(tagIds.includes(tagId) ? tagIds.filter((id) => id !== tagId) : [...tagIds, tagId]);
  const name = query.trim();
  const exact = name ? findTagByName(deckTags, name) : null;
  const shown = name ? searchTags(deckTags, name) : deckTags;

  /** Enter: puts the tag of that name on the deck, created first if it does not exist. */
  const submit = () => {
    if (!name) return;
    const id = exact?.id ?? createDeckTag(name);
    if (!tagIds.includes(id)) setTagIds([...tagIds, id]);
    setQuery('');
  };

  return (
    <div ref={rootRef} className="relative flex items-center gap-1.5 flex-wrap">
      {getDeckTags(deck, deckTags).map((tag) => (
        <TagChip key={tag.id} tag={tag} onRemove={() => toggle(tag.id)} />
      ))}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 px-1.5 py-px rounded-md text-[11px] text-slate-500 hover:text-white ring-1 ring-inset ring-white/10 hover:ring-white/20 transition-colors"
      >
        {tagIds.length ? <Plus size={11} /> : <Tag size={11} />}
        {tagIds.length ? 'Tag' : 'Ajouter un tag'}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            className="surface absolute z-30 top-full left-0 mt-1.5 w-64 rounded-xl p-2"
          >
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="Chercher ou créer un tag"
              maxLength={40}
              className="field py-1.5 text-xs"
              aria-label="Nom du tag"
            />
            <div className="mt-1.5 max-h-56 overflow-y-auto scrollbar-thin">
              {shown.map((tag) => {
                const on = tagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggle(tag.id)}
                    role="menuitemcheckbox"
                    aria-checked={on}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-left text-slate-300 hover:bg-white/5 hover:text-white"
                  >
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: tag.color }} />
                    <span className="flex-1 min-w-0 truncate">{tag.name}</span>
                    {on && <Check size={13} className="flex-shrink-0 text-indigo-300" />}
                  </button>
                );
              })}
              {name && !exact && (
                <button
                  type="button"
                  onClick={submit}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-left text-indigo-200 hover:bg-indigo-500/10"
                >
                  <Plus size={13} className="flex-shrink-0" />
                  <span className="truncate">Créer « {name} »</span>
                </button>
              )}
              {deckTags.length === 0 && !name && (
                <p className="px-2 py-1.5 text-xs text-slate-500">Aucun tag pour l’instant : tape un nom et Entrée pour le créer.</p>
              )}
            </div>
            {deckTags.length > 0 && (
              <div className="mt-1.5 pt-1.5 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setManageOpen(true);
                  }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-slate-400 hover:bg-white/5 hover:text-white"
                >
                  <Settings2 size={13} /> Gérer les tags
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <DeckTagsModal isOpen={manageOpen} onClose={() => setManageOpen(false)} />
    </div>
  );
};

/** One tag of the management list: color, name, decks using it, order and deletion. */
const TagRow = ({ tag, index, count, total }) => {
  const notify = useToast();
  const { deckTags, updateDeckTag, deleteDeckTag, restoreDeckTag, moveDeckTag } = useStore();
  const [colorsOpen, setColorsOpen] = useState(false);

  /** Keeps the new name unless it is empty or another tag's. */
  const rename = (input) => {
    const name = input.value.trim();
    const other = findTagByName(deckTags, name);
    if (!name || (other && other.id !== tag.id)) {
      input.value = tag.name;
      return;
    }
    if (name !== tag.name) updateDeckTag(tag.id, { name });
  };

  const remove = () => {
    const snapshot = deleteDeckTag(tag.id);
    if (!snapshot) return;
    notify({
      message: `Tag « ${tag.name} » supprimé${count ? ` de ${count} deck${count > 1 ? 's' : ''}` : ''}`,
      action: { label: 'Annuler', onClick: () => restoreDeckTag(snapshot) },
      duration: 7000,
    });
  };

  return (
    <li className="py-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setColorsOpen((o) => !o)}
          className="w-6 h-6 flex-shrink-0 rounded-md flex items-center justify-center hover:bg-white/5"
          title="Changer la couleur"
          aria-label={`Couleur du tag ${tag.name}`}
          aria-expanded={colorsOpen}
        >
          <span className="w-3 h-3 rounded-full" style={{ background: tag.color }} />
        </button>
        <input
          key={tag.name}
          defaultValue={tag.name}
          onBlur={(e) => rename(e.target)}
          onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
          maxLength={40}
          className="flex-1 min-w-0 bg-transparent text-sm text-white rounded px-1.5 py-1 hover:bg-white/[0.03] focus:outline-none focus:ring-1 focus:ring-indigo-400"
          aria-label={`Nom du tag ${tag.name}`}
        />
        <span className="text-[11px] text-slate-500 tabular-nums whitespace-nowrap">
          {count} deck{count > 1 ? 's' : ''}
        </span>
        <button
          type="button"
          onClick={() => moveDeckTag(tag.id, -1)}
          disabled={index === 0}
          className="btn-icon p-1"
          aria-label={`Monter le tag ${tag.name}`}
        >
          <ChevronUp size={14} />
        </button>
        <button
          type="button"
          onClick={() => moveDeckTag(tag.id, 1)}
          disabled={index === total - 1}
          className="btn-icon p-1"
          aria-label={`Descendre le tag ${tag.name}`}
        >
          <ChevronDown size={14} />
        </button>
        <button type="button" onClick={remove} className="btn-icon p-1 hover:text-rose-300" aria-label={`Supprimer le tag ${tag.name}`}>
          <Trash2 size={14} />
        </button>
      </div>
      {colorsOpen && (
        <div className="flex gap-1.5 mt-2 ml-8">
          {TAG_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => {
                updateDeckTag(tag.id, { color });
                setColorsOpen(false);
              }}
              className={`w-5 h-5 rounded-full ring-offset-2 ring-offset-slate-900 ${tag.color === color ? 'ring-2 ring-white/70' : 'hover:ring-2 hover:ring-white/30'}`}
              style={{ background: color }}
              aria-label={`Couleur ${color}`}
              aria-pressed={tag.color === color}
            />
          ))}
        </div>
      )}
    </li>
  );
};

/** Every deck tag: rename, recolor, order (the order of the filters), delete, create. */
export const DeckTagsModal = ({ isOpen, onClose }) => {
  const { deckTags, decks, createDeckTag } = useStore();
  const [name, setName] = useState('');
  const create = () => {
    if (!name.trim()) return;
    createDeckTag(name);
    setName('');
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Tags des decks">
      <div className="px-6 pb-6 pt-2">
        <p className="text-xs text-slate-500 leading-relaxed">
          L’ordre des tags est celui des filtres de la liste des decks. Supprimer un tag le retire de tous les decks.
        </p>
        {deckTags.length === 0 ? (
          <p className="text-sm text-slate-400 py-6 text-center">Aucun tag pour l’instant.</p>
        ) : (
          <ul className="mt-2 divide-y divide-white/5">
            {deckTags.map((tag, i) => (
              <TagRow
                key={tag.id}
                tag={tag}
                index={i}
                total={deckTags.length}
                count={decks.filter((d) => d.tags?.includes(tag.id)).length}
              />
            ))}
          </ul>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
          className="flex gap-2 mt-4"
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nouveau tag"
            maxLength={40}
            className="field py-2"
            aria-label="Nom du nouveau tag"
          />
          <button type="submit" disabled={!name.trim()} className="btn-primary px-3 py-2 flex-shrink-0">
            <Plus size={15} /> Créer
          </button>
        </form>
      </div>
    </Modal>
  );
};
