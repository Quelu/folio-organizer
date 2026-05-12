import { ChevronRight } from 'lucide-react';

const GAME_COLORS = {
  lorcana: 'bg-blue-500',
  pokemon: 'bg-yellow-500',
  magic: 'bg-purple-500',
  other: 'bg-gray-500',
};

const BinderItem = ({ binder, isActive, onSelect }) => {
  const cardCount = Object.values(binder.cards).reduce((sum, c) => sum + c.quantity, 0);

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-3 transition-all group ${
        isActive
          ? 'bg-indigo-600/20 border border-indigo-500/40 text-white'
          : 'hover:bg-gray-800 text-gray-400 hover:text-white border border-transparent'
      }`}
    >
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${GAME_COLORS[binder.gameType] ?? 'bg-gray-500'}`} />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{binder.name}</div>
        <div className="text-xs text-gray-500">
          {cardCount} carte{cardCount !== 1 ? 's' : ''} · {binder.gridRows}×{binder.gridCols}
        </div>
      </div>
      {isActive && <ChevronRight size={14} className="text-indigo-400 flex-shrink-0" />}
    </button>
  );
};

export default BinderItem;
