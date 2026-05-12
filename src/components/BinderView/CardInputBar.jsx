import { useRef, useCallback, useEffect } from 'react';
import { Hash, Plus, Minus } from 'lucide-react';
import { useKeyboardInput } from '../../hooks/useKeyboardInput';

const GAME_BADGE = {
  lorcana: { label: 'Lorcana', className: 'bg-blue-600/30 text-blue-300 border border-blue-500/30' },
  pokemon: { label: 'Pokémon', className: 'bg-yellow-600/30 text-yellow-300 border border-yellow-500/30' },
  magic: { label: 'Magic', className: 'bg-purple-600/30 text-purple-300 border border-purple-500/30' },
  other: { label: 'Autre', className: 'bg-gray-700/50 text-gray-300 border border-gray-600/30' },
};

const CardInputBar = ({ binder, onAdd, onIncrement, onDecrement, onRemoveLast }) => {
  const inputRef = useRef(null);
  const badge = GAME_BADGE[binder.gameType] ?? GAME_BADGE.other;

  // Re-focus input when binder changes
  useEffect(() => {
    inputRef.current?.focus();
  }, [binder.id]);

  const handleAdd = useCallback(
    (num) => {
      onAdd(num);
      if (inputRef.current) inputRef.current.value = '';
      inputRef.current?.focus();
    },
    [onAdd]
  );

  const handleIncrement = useCallback(
    (num) => {
      onIncrement(num);
      inputRef.current?.focus();
    },
    [onIncrement]
  );

  const handleDecrement = useCallback(
    (num) => {
      onDecrement(num);
      inputRef.current?.focus();
    },
    [onDecrement]
  );

  const handleRemoveLast = useCallback(() => {
    onRemoveLast();
    inputRef.current?.focus();
  }, [onRemoveLast]);

  useKeyboardInput(inputRef, {
    onAdd: handleAdd,
    onIncrement: handleIncrement,
    onDecrement: handleDecrement,
    onRemoveLast: handleRemoveLast,
  });

  const clickAdd = () => {
    const val = parseInt(inputRef.current?.value, 10);
    if (!isNaN(val) && val > 0) handleAdd(val);
  };

  const clickIncrement = () => {
    const val = parseInt(inputRef.current?.value, 10);
    if (!isNaN(val) && val > 0) handleIncrement(val);
  };

  const clickDecrement = () => {
    const val = parseInt(inputRef.current?.value, 10);
    if (!isNaN(val) && val > 0) handleDecrement(val);
  };

  return (
    <div className="bg-gray-900/80 backdrop-blur border-b border-gray-800 p-4">
      <div className="flex items-center gap-3 max-w-2xl mx-auto">
        {/* Game type badge */}
        <span className={`px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap ${badge.className}`}>
          {badge.label}
        </span>

        {/* Number input */}
        <div className="flex-1 relative">
          <Hash size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            ref={inputRef}
            type="number"
            min="1"
            placeholder="N° de carte..."
            autoFocus
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none text-sm"
          />
        </div>

        {/* − button */}
        <button
          onClick={clickDecrement}
          title="Diminuer la quantité (ou touche -)"
          className="p-2.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white border border-gray-700 transition-colors flex-shrink-0"
        >
          <Minus size={16} />
        </button>

        {/* + / Add button */}
        <button
          onClick={clickAdd}
          title="Ajouter la carte (ou touche Entrée)"
          className="p-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white border border-indigo-500/50 transition-colors flex-shrink-0"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Keyboard hints */}
      <div className="flex gap-4 mt-2 max-w-2xl mx-auto">
        <span className="text-xs text-gray-600">
          <kbd className="text-gray-500">↵</kbd> Ajouter
        </span>
        <span className="text-xs text-gray-600">
          <kbd className="text-gray-500">+</kbd><kbd className="text-gray-500">-</kbd> Quantité
        </span>
        <span className="text-xs text-gray-600">
          <kbd className="text-gray-500">⌫</kbd> Annuler dernier
        </span>
      </div>
    </div>
  );
};

export default CardInputBar;
