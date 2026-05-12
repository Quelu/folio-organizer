import { useEffect } from 'react';

/**
 * Attaches keyboard shortcuts to a number input for fast card entry.
 * @param {React.RefObject<HTMLInputElement>} inputRef
 * @param {{ onAdd, onIncrement, onDecrement, onRemoveLast }} callbacks
 */
export const useKeyboardInput = (inputRef, { onAdd, onIncrement, onDecrement, onRemoveLast }) => {
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const handleKeyDown = (e) => {
      const rawValue = input.value;
      const parsed = parseInt(rawValue, 10);
      const hasValue = !isNaN(parsed) && parsed > 0;
      const isEmpty = rawValue === '' || rawValue === '0';

      switch (e.key) {
        case 'Enter':
          e.preventDefault();
          if (hasValue) onAdd(parsed);
          break;
        case '+':
          e.preventDefault();
          if (hasValue) onIncrement(parsed);
          break;
        case '-':
          e.preventDefault();
          if (hasValue) onDecrement(parsed);
          break;
        case 'Backspace':
          if (isEmpty) {
            e.preventDefault();
            onRemoveLast();
          }
          break;
      }
    };

    input.addEventListener('keydown', handleKeyDown);
    return () => input.removeEventListener('keydown', handleKeyDown);
  }, [inputRef, onAdd, onIncrement, onDecrement, onRemoveLast]);
};
