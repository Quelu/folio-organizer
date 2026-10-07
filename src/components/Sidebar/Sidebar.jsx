import { useRef, useState } from 'react';
import { Plus, Search, Download, Upload, Library, X } from 'lucide-react';
import { motion, AnimatePresence, LayoutGroup } from 'motion/react';
import BinderItem from './BinderItem';

const SidebarContent = ({
  binders,
  activeBinderId,
  onSelect,
  onCreateNew,
  onEdit,
  onDuplicate,
  onDelete,
  onExportBackup,
  onImportBackup,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const fileRef = useRef(null);
  const filtered = query
    ? binders.filter((b) => b.name.toLowerCase().includes(query.toLowerCase()))
    : binders;

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

      <div className="px-3">
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

      <nav className="flex-1 overflow-y-auto scrollbar-thin px-3 pb-3 space-y-1">
        <AnimatePresence initial={false}>
          {filtered.map((binder) => (
            <motion.div
              key={binder.id}
              layout
              initial={{ opacity: 0, x: -16, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: -24, scale: 0.94, transition: { duration: 0.18 } }}
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            >
              <BinderItem
                binder={binder}
                isActive={binder.id === activeBinderId}
                onSelect={() => onSelect(binder.id)}
                onEdit={() => onEdit(binder)}
                onDuplicate={() => onDuplicate(binder.id)}
                onDelete={() => onDelete(binder.id)}
              />
            </motion.div>
          ))}
        </AnimatePresence>
        {binders.length === 0 && (
          <p className="text-slate-600 text-sm text-center mt-8 px-4 leading-relaxed">
            Aucune farde pour l'instant.
          </p>
        )}
        {binders.length > 0 && filtered.length === 0 && (
          <p className="text-slate-600 text-sm text-center mt-6">Aucun résultat.</p>
        )}
      </nav>

      <div className="p-3 border-t border-white/5 flex gap-1">
        <button
          onClick={onExportBackup}
          disabled={binders.length === 0}
          className="btn-icon flex-1 gap-2 text-xs"
          title="Télécharger une sauvegarde de toutes tes fardes"
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
              />
            </LayoutGroup>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  </>
);

export default Sidebar;
