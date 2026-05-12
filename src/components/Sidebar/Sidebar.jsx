import { Plus, BookOpen } from 'lucide-react';
import BinderItem from './BinderItem';

const Sidebar = ({ binders, activeBinderId, onSelect, onCreateNew }) => {
  return (
    <aside className="w-72 bg-gray-900 border-r border-gray-800 flex flex-col h-full flex-shrink-0">
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-center gap-2 text-indigo-400 font-bold text-lg">
          <BookOpen size={22} />
          <span>Binder Organizer</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {binders.map((binder) => (
          <BinderItem
            key={binder.id}
            binder={binder}
            isActive={binder.id === activeBinderId}
            onSelect={() => onSelect(binder.id)}
          />
        ))}
        {binders.length === 0 && (
          <p className="text-gray-600 text-sm text-center mt-10 px-4 leading-relaxed">
            Aucune farde.
            <br />
            Crée ta première collection !
          </p>
        )}
      </div>

      <div className="p-3 border-t border-gray-800">
        <button
          onClick={onCreateNew}
          className="w-full flex items-center gap-2 justify-center py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors text-sm"
        >
          <Plus size={18} />
          Nouvelle farde
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
