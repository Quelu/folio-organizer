import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';

/**
 * Shared modal shell: backdrop, Escape to close, title bar. Rendered in <body> so a modal opened
 * from another one is not positioned inside its (transformed) parent.
 */
const Modal = ({ isOpen, onClose, title, children, size = 'md' }) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const width = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl' }[size];

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-950/80 z-40 backdrop-blur-sm"
          />
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 pointer-events-none">
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={title}
              initial={{ opacity: 0, y: 32, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 32, scale: 0.97 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className={`surface w-full ${width} pointer-events-auto rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto`}
            >
              {title && (
                <div className="flex items-center justify-between px-6 pt-5 pb-1">
                  <h2 className="text-base font-semibold text-white">{title}</h2>
                  <button onClick={onClose} className="btn-icon -mr-2" aria-label="Fermer">
                    <X size={18} />
                  </button>
                </div>
              )}
              {children}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default Modal;
