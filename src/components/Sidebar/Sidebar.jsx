import { useRef, useState } from 'react';
import {
  Plus,
  Search,
  Download,
  Upload,
  Library,
  X,
  Layers,
  LayoutGrid,
  ArrowLeftRight,
  Sparkles,
  CalendarClock,
  FolderSync,
  FolderOpen,
  AlertTriangle,
  FlaskConical,
} from 'lucide-react';
import { motion, AnimatePresence, LayoutGroup, Reorder, useDragControls } from 'motion/react';
import BinderItem from './BinderItem';
import CatalogStatus from './CatalogStatus';

const NAV_ITEMS = [
  { kind: 'decks', label: 'Decks', icon: Layers },
  { kind: 'simulation', label: 'Simulation', icon: FlaskConical },
  { kind: 'stats', label: 'Collection', icon: LayoutGrid },
  { kind: 'trades', label: 'Échanges', icon: ArrowLeftRight },
  { kind: 'rotation', label: 'Rotation', icon: CalendarClock },
  { kind: 'assistant', label: 'Assistant IA', icon: Sparkles },
];

const formatTime = (at) => new Date(at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });

/**
 * Automatic backup into a folder (see useAutoBackup): off, on with the last write, or paused
 * until a click gives the browser the right to write again.
 */
const AutoBackupRow = ({ autoBackup, onChoose }) => {
  if (!autoBackup?.supported) return null;
  const { status, folderName, savedAt, resume, stop } = autoBackup;
  if (status === 'off') {
    return (
      <button
        onClick={onChoose}
        className="btn-icon w-full justify-start gap-2 text-xs"
        title="Écrit une sauvegarde dans un dossier à chaque changement, par exemple pour le serveur MCP de Claude Desktop"
      >
        <FolderSync size={14} /> Sauvegarde auto dans un dossier…
      </button>
    );
  }
  if (status !== 'on') {
    return (
      <button
        onClick={status === 'paused' ? resume : onChoose}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-amber-300 hover:bg-amber-400/10 transition-colors"
        title={status === 'paused' ? `Autoriser à nouveau l'écriture dans « ${folderName} »` : 'Choisir un autre dossier'}
      >
        <AlertTriangle size={14} className="flex-shrink-0" />
        <span className="truncate">
          {status === 'paused' ? 'Sauvegarde auto en pause : reprendre' : 'Échec de la sauvegarde auto : changer de dossier'}
        </span>
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1 pl-2 text-xs text-slate-500">
      <FolderSync size={14} className="flex-shrink-0 text-emerald-400/80" />
      <span className="flex-1 min-w-0 truncate" title={`Sauvegarde automatique dans « ${folderName} »`}>
        Auto · {folderName}
        {savedAt && <span className="text-slate-600"> · {formatTime(savedAt)}</span>}
      </span>
      <button onClick={onChoose} className="btn-icon p-1.5" title="Changer de dossier" aria-label="Changer le dossier de sauvegarde">
        <FolderOpen size={13} />
      </button>
      <button onClick={stop} className="btn-icon p-1.5" title="Arrêter la sauvegarde automatique" aria-label="Arrêter la sauvegarde automatique">
        <X size={13} />
      </button>
    </div>
  );
};

/** Collection-wide screens, above the binder list. */
const NavItem = ({ item, isActive, badge, onClick }) => (
  <button
    onClick={onClick}
    className={`relative w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
      isActive ? 'bg-white/[0.07] text-white ring-1 ring-inset ring-white/10' : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
    }`}
    aria-current={isActive ? 'page' : undefined}
  >
    <item.icon size={16} className={isActive ? 'text-indigo-300' : ''} />
    <span className="flex-1 text-left">{item.label}</span>
    {badge > 0 && <span className="text-[11px] tabular-nums text-slate-500">{badge}</span>}
  </button>
);

/** A binder of the list, dragged into place by its grip; onDrop saves the new order. */
const SortableBinder = ({ binder, canDrag, onDrop, ...itemProps }) => {
  const controls = useDragControls();
  const [dragging, setDragging] = useState(false);
  return (
    <Reorder.Item
      value={binder.id}
      dragListener={false}
      dragControls={controls}
      onDragStart={() => setDragging(true)}
      onDragEnd={() => {
        setDragging(false);
        onDrop();
      }}
      whileDrag={{ scale: 1.02 }}
      className={`rounded-xl ${dragging ? 'bg-slate-900 shadow-xl shadow-black/40 ring-1 ring-inset ring-white/10' : ''}`}
      initial={{ opacity: 0, x: -16, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -24, scale: 0.94, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
    >
      <BinderItem binder={binder} onDragStart={canDrag ? (e) => controls.start(e) : null} {...itemProps} />
    </Reorder.Item>
  );
};

const SidebarContent = ({
  binders,
  view,
  deckCount,
  onNavigate,
  onSearch,
  cardLanguage,
  onCardLanguage,
  activeBinderId,
  onSelect,
  onCreateNew,
  onEdit,
  onDuplicate,
  onReorder,
  onDelete,
  onShare,
  onExportBackup,
  onImportBackup,
  autoBackup,
  onChooseBackupFolder,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const fileRef = useRef(null);
  // Ids in their new order while a binder is dragged, saved once it is dropped
  const [draft, setDraft] = useState(null);
  const draftRef = useRef(null);
  const filtered = query
    ? binders.filter((b) => b.name.toLowerCase().includes(query.toLowerCase()))
    : binders;
  // The order of a search result says nothing about where the others go
  const canReorder = !query && binders.length > 1;
  const byId = new Map(binders.map((b) => [b.id, b]));
  const order = draft ?? filtered.map((b) => b.id);

  const changeDraft = (ids) => {
    draftRef.current = ids;
    setDraft(ids);
  };
  const saveDraft = () => {
    if (draftRef.current) onReorder(draftRef.current);
    draftRef.current = null;
    setDraft(null);
  };
  const moveBy = (binderId, delta) => {
    const ids = binders.map((b) => b.id);
    const from = ids.indexOf(binderId);
    ids.splice(from + delta, 0, ...ids.splice(from, 1));
    onReorder(ids);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-5 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/30">
            <Library size={17} className="text-white" />
          </div>
          <div>
            <div className="font-bold text-white leading-tight">Folio</div>
            <div className="text-[11px] text-slate-500 leading-tight">Organiseur de fardes</div>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="btn-icon lg:hidden" aria-label="Fermer le menu">
            <X size={18} />
          </button>
        )}
      </div>

      <div className="px-3 space-y-1">
        <button
          onClick={onSearch}
          className="w-full flex items-center gap-2.5 px-3 py-2 mb-2 rounded-lg text-sm text-slate-500 bg-slate-950/60 ring-1 ring-inset ring-white/10 hover:text-slate-300 hover:ring-white/20 transition-colors"
        >
          <Search size={15} />
          <span className="flex-1 text-left">Chercher une carte…</span>
          <kbd className="kbd">⌘K</kbd>
        </button>
        {NAV_ITEMS.map((item) => (
          <NavItem
            key={item.kind}
            item={item}
            isActive={view.kind === item.kind}
            badge={item.kind === 'decks' ? deckCount : 0}
            onClick={() => onNavigate({ kind: item.kind })}
          />
        ))}
      </div>

      <div className="px-3 mt-4">
        <button onClick={onCreateNew} className="btn-primary w-full">
          <Plus size={17} />
          Nouvelle farde
        </button>
      </div>

      {binders.length > 5 && (
        <div className="px-3 mt-3 relative">
          <Search size={14} className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher une farde…"
            className="field pl-8 py-2"
          />
        </div>
      )}

      <div className="px-5 mt-5 mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
        Mes fardes {binders.length > 0 && <span className="text-slate-700">· {binders.length}</span>}
      </div>

      <motion.nav layoutScroll className="flex-1 overflow-y-auto scrollbar-thin px-3 pb-3">
        <Reorder.Group axis="y" values={order} onReorder={changeDraft} className="space-y-1">
          <AnimatePresence initial={false}>
            {order.map((id, i) => {
              const binder = byId.get(id);
              if (!binder) return null;
              return (
                <SortableBinder
                  key={id}
                  binder={binder}
                  canDrag={canReorder}
                  onDrop={saveDraft}
                  isActive={id === activeBinderId}
                  onSelect={() => onSelect(id)}
                  onEdit={() => onEdit(binder)}
                  onDuplicate={() => onDuplicate(id)}
                  onMoveUp={canReorder && i > 0 ? () => moveBy(id, -1) : null}
                  onMoveDown={canReorder && i < order.length - 1 ? () => moveBy(id, 1) : null}
                  onDelete={() => onDelete(id)}
                  onShare={binder.gameType === 'lorcana' && binder.setCode ? () => onShare(binder) : null}
                />
              );
            })}
          </AnimatePresence>
        </Reorder.Group>
        {binders.length === 0 && (
          <p className="text-slate-600 text-sm text-center mt-8 px-4 leading-relaxed">
            Aucune farde pour l'instant.
          </p>
        )}
        {binders.length > 0 && filtered.length === 0 && (
          <p className="text-slate-600 text-sm text-center mt-6">Aucun résultat.</p>
        )}
      </motion.nav>

      <div className="border-t border-white/5">
        <CatalogStatus />
      </div>
      <div className="px-4 pt-2.5 flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Langue des cartes</span>
        <div className="flex items-center rounded-lg ring-1 ring-inset ring-white/10 p-0.5" role="group" aria-label="Langue des cartes">
          {[
            { key: 'fr', label: 'FR', title: 'Noms, textes et images en français' },
            { key: 'en', label: 'EN', title: 'Noms, textes et images en anglais' },
          ].map((l) => (
            <button
              key={l.key}
              onClick={() => onCardLanguage(l.key)}
              aria-pressed={cardLanguage === l.key}
              title={l.title}
              className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors ${
                cardLanguage === l.key ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-white'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-3 pt-2">
        <AutoBackupRow autoBackup={autoBackup} onChoose={onChooseBackupFolder} />
      </div>
      <div className="p-3 pt-1 flex gap-1">
        <button
          onClick={onExportBackup}
          disabled={binders.length === 0}
          className="btn-icon flex-1 gap-2 text-xs"
          title="Télécharger une sauvegarde de toutes tes fardes et de tes decks"
        >
          <Download size={14} /> Sauvegarder
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="btn-icon flex-1 gap-2 text-xs"
          title="Restaurer depuis un fichier de sauvegarde"
        >
          <Upload size={14} /> Restaurer
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImportBackup(file);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
};

/** Persistent sidebar on large screens, slide-in drawer on small screens. */
const Sidebar = ({ isOpen, onClose, ...props }) => (
  <>
    <aside className="hidden lg:block w-72 flex-shrink-0 h-full bg-slate-950/60 border-r border-white/5">
      <LayoutGroup id="sidebar-desktop">
        <SidebarContent {...props} />
      </LayoutGroup>
    </aside>

    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="lg:hidden fixed inset-0 z-30 bg-slate-950/70 backdrop-blur-sm"
          />
          <motion.aside
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="lg:hidden fixed inset-y-0 left-0 z-40 w-[85vw] max-w-xs bg-slate-950 border-r border-white/5"
          >
            <LayoutGroup id="sidebar-drawer">
              <SidebarContent
                {...props}
                onClose={onClose}
                onSelect={(id) => {
                  props.onSelect(id);
                  onClose();
                }}
                onNavigate={(v) => {
                  props.onNavigate(v);
                  onClose();
                }}
                onSearch={() => {
                  props.onSearch();
                  onClose();
                }}
              />
            </LayoutGroup>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  </>
);

export default Sidebar;
