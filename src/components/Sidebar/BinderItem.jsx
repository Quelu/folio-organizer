import { MoreHorizontal, Pencil, Copy, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import Menu from '../ui/Menu';
import ProgressBar from '../ui/ProgressBar';
import { getGame, getLorcanaSetName } from '../../data/games';
import { getBinderStats } from '../../utils/calculations';

const BinderItem = ({ binder, isActive, onSelect, onEdit, onDuplicate, onDelete }) => {
  const game = getGame(binder.gameType);
  const { copies, owned, progress } = getBinderStats(binder);
  const subtitle =
    binder.gameType === 'lorcana' && binder.setCode
      ? getLorcanaSetName(binder.setCode) ?? `Set ${binder.setCode}`
      : game.fullLabel;

  return (
    <div
      className={`group relative rounded-xl transition-colors ${isActive ? '' : 'hover:bg-white/[0.04]'}`}
    >
      {/* Active background and accent glide from one binder to the next */}
      {isActive && (
        <motion.div
          layoutId="active-binder"
          className="absolute inset-0 rounded-xl bg-white/[0.07] ring-1 ring-inset ring-white/10"
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        >
          <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r bg-indigo-400 shadow-[0_0_10px_rgba(129,140,248,0.8)]" />
        </motion.div>
      )}
      <button onClick={onSelect} className="relative w-full text-left pl-4 pr-10 py-3">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${game.dot}`} />
          <span className={`font-medium text-sm truncate ${isActive ? 'text-white' : 'text-slate-300'}`}>
            {binder.name}
          </span>
        </div>
        <div className="text-xs text-slate-500 mt-0.5 pl-4 truncate">
          {subtitle} · {copies} carte{copies !== 1 ? 's' : ''}
        </div>
        {progress !== null && (
          <div className="mt-2 ml-4 flex items-center gap-2">
            <ProgressBar value={progress} className="flex-1 h-1" />
            <span className="text-[10px] tabular-nums text-slate-500 w-14 text-right">
              {owned}/{binder.setSize}
            </span>
          </div>
        )}
      </button>
      <div
        className={`absolute right-1.5 top-2 transition-opacity ${
          isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
        }`}
      >
        <Menu
          label={`Actions pour ${binder.name}`}
          trigger={
            <span className="btn-icon p-1.5">
              <MoreHorizontal size={16} />
            </span>
          }
          items={[
            { label: 'Modifier', icon: Pencil, onClick: onEdit },
            { label: 'Dupliquer (vide)', icon: Copy, onClick: onDuplicate },
            'divider',
            { label: 'Supprimer', icon: Trash2, onClick: onDelete, danger: true },
          ]}
        />
      </div>
    </div>
  );
};

export default BinderItem;
