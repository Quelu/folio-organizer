import {
  Menu as MenuIcon,
  Pencil,
  Download,
  RotateCcw,
  MoreHorizontal,
  Trash2,
  Copy,
  BookOpen,
  Square,
  ShoppingCart,
  Heart,
} from 'lucide-react';
import { motion } from 'motion/react';
import Menu from '../ui/Menu';
import AnimatedNumber from '../ui/AnimatedNumber';
import ProgressBar from '../ui/ProgressBar';
import { getGame, getLorcanaSetName } from '../../data/games';
import { getBinderStats } from '../../utils/calculations';

const StatChip = ({ label, value }) => (
  <div className="flex items-baseline gap-1.5">
    <AnimatedNumber value={value} className="text-sm font-bold text-white" />
    <span className="text-xs text-slate-500">{label}</span>
  </div>
);

const BinderHeader = ({
  binder,
  spreadMode,
  canSpread,
  pendingExport,
  totalExported,
  onToggleView,
  onOpenSidebar,
  onEdit,
  onDuplicate,
  onDelete,
  onExport,
  onResetExports,
  onCardmarket,
  onWantList,
}) => {
  const game = getGame(binder.gameType);
  const { unique, copies, foils, owned, outOfSet, progress } = getBinderStats(binder);
  const setName = binder.gameType === 'lorcana' ? getLorcanaSetName(binder.setCode) : null;

  return (
    <header className="px-4 sm:px-6 pt-4 pb-3">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-start gap-3">
          <button onClick={onOpenSidebar} className="btn-icon lg:hidden -ml-2 mt-0.5" aria-label="Ouvrir le menu">
            <MenuIcon size={20} />
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${game.badge}`}>{game.label}</span>
              {setName && <span className="text-xs text-slate-500 truncate">Set {binder.setCode} · {setName}</span>}
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-white line-clamp-2 break-words mt-1">{binder.name}</h1>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            {canSpread && (
              <div className="hidden lg:flex items-center rounded-lg ring-1 ring-inset ring-white/10 p-0.5 mr-1">
                <button
                  onClick={() => onToggleView('single')}
                  className={`px-2 py-1.5 rounded-md transition-colors ${!spreadMode ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-white'}`}
                  title="Une page"
                  aria-pressed={!spreadMode}
                >
                  <Square size={15} />
                </button>
                <button
                  onClick={() => onToggleView('spread')}
                  className={`px-2 py-1.5 rounded-md transition-colors ${spreadMode ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-white'}`}
                  title="Farde ouverte (deux pages)"
                  aria-pressed={spreadMode}
                >
                  <BookOpen size={15} />
                </button>
              </div>
            )}

            {binder.gameType === 'lorcana' && (
              <button
                onClick={onExport}
                disabled={pendingExport === 0}
                className="btn-secondary px-3 py-2"
                title={
                  pendingExport > 0
                    ? `Exporter ${pendingExport} exemplaire(s) vers Dreamborn (CSV)`
                    : totalExported > 0
                      ? 'Tout est déjà exporté'
                      : 'Aucune carte à exporter'
                }
              >
                <Download size={15} />
                <span className="hidden sm:inline">Dreamborn</span>
                {pendingExport > 0 && (
                  <motion.span
                    key={pendingExport}
                    initial={{ scale: 1.6, backgroundColor: 'rgba(52,211,153,0.6)' }}
                    animate={{ scale: 1, backgroundColor: 'rgba(16,185,129,0.2)' }}
                    transition={{ type: 'spring', stiffness: 500, damping: 18 }}
                    className="px-1.5 rounded-full text-emerald-300 text-[11px] font-bold tabular-nums"
                  >
                    {pendingExport}
                  </motion.span>
                )}
              </button>
            )}

            <button onClick={onEdit} className="btn-icon" title="Modifier la farde" aria-label="Modifier la farde">
              <Pencil size={16} />
            </button>

            <Menu
              label="Plus d'actions"
              trigger={
                <span className="btn-icon">
                  <MoreHorizontal size={18} />
                </span>
              }
              items={[
                binder.gameType === 'lorcana'
                  ? { label: 'Voir dans la want list', icon: Heart, onClick: onWantList }
                  : null,
                binder.gameType === 'lorcana'
                  ? { label: 'Manquantes → Cardmarket', icon: ShoppingCart, onClick: onCardmarket }
                  : null,
                { label: 'Dupliquer (vide)', icon: Copy, onClick: onDuplicate },
                binder.gameType === 'lorcana' && totalExported > 0
                  ? { label: "Réinitialiser l'export", icon: RotateCcw, onClick: onResetExports }
                  : null,
                'divider',
                { label: 'Supprimer la farde', icon: Trash2, onClick: onDelete, danger: true },
              ]}
            />
          </div>
        </div>

        <div className="flex items-center gap-x-5 gap-y-2 mt-3 flex-wrap">
          <StatChip value={unique} label={`carte${unique !== 1 ? 's' : ''} unique${unique !== 1 ? 's' : ''}`} />
          <StatChip value={copies} label={`exemplaire${copies !== 1 ? 's' : ''}`} />
          {foils > 0 && <StatChip value={foils} label={<span className="foil-text font-semibold">foil{foils !== 1 ? 's' : ''}</span>} />}
          {progress !== null && (
            <div className="flex items-center gap-2.5 flex-1 min-w-[180px] max-w-sm">
              <ProgressBar value={progress} className="flex-1 h-1.5" />
              <span className="text-xs text-slate-400 tabular-nums whitespace-nowrap">
                <AnimatedNumber value={Math.floor(progress * 100)} className="font-bold text-white" />
                <b className="text-white"> %</b> · <AnimatedNumber value={owned} />/{binder.setSize}
                {outOfSet > 0 && (
                  <span
                    className="text-slate-500"
                    title={`Cartes numérotées au-delà de ${binder.setSize}, non comptées dans la progression`}
                  >
                    {' '}
                    · +<AnimatedNumber value={outOfSet} /> hors set
                  </span>
                )}
              </span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default BinderHeader;
