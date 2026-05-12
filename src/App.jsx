import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { useBinders } from './hooks/useBinders';
import Sidebar from './components/Sidebar/Sidebar';
import BinderView from './components/BinderView/BinderView';
import CreateBinderModal from './components/Modals/CreateBinderModal';

const App = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const {
    binders,
    activeBinder,
    createBinder,
    setActiveBinder,
    addCard,
    removeCard,
    removeLastAdded,
    bulkMarkExported,
    resetExports,
  } = useBinders();

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 overflow-hidden">
      <Sidebar
        binders={binders}
        activeBinderId={activeBinder?.id ?? null}
        onSelect={setActiveBinder}
        onCreateNew={() => setIsModalOpen(true)}
      />

      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        {activeBinder ? (
          <BinderView
            key={activeBinder.id}
            binder={activeBinder}
            onAddCard={addCard}
            onRemoveCard={removeCard}
            onRemoveLastAdded={removeLastAdded}
            onBulkMarkExported={bulkMarkExported}
            onResetExports={resetExports}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-5 text-center p-8">
            <BookOpen size={72} className="text-gray-800" />
            <div>
              <h1 className="text-3xl font-black text-gray-300 mb-2">Binder Organizer</h1>
              <p className="text-gray-600 max-w-sm leading-relaxed">
                Organise tes cartes TCG dans tes fardes. Sache exactement sur quelle page et dans
                quel emplacement chaque carte se trouve.
              </p>
            </div>
            <button
              onClick={() => setIsModalOpen(true)}
              className="mt-2 py-3 px-8 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-semibold transition-colors shadow-lg shadow-indigo-500/20"
            >
              Créer ma première farde
            </button>
          </div>
        )}
      </main>

      <CreateBinderModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onCreate={createBinder}
      />
    </div>
  );
};

export default App;
