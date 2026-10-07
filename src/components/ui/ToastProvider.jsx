import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { ToastContext } from './toastContext';

const TONES = {
  success: { icon: CheckCircle2, className: 'text-emerald-400', bar: 'bg-emerald-400/60' },
  error: { icon: AlertTriangle, className: 'text-rose-400', bar: 'bg-rose-400/60' },
  info: { icon: Info, className: 'text-indigo-300', bar: 'bg-indigo-400/60' },
};

const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const notify = useCallback(
    ({ message, tone = 'info', action, duration = 4500 }) => {
      const id = ++idRef.current;
      setToasts((t) => [...t.slice(-2), { id, message, tone, action, duration }]);
      setTimeout(() => dismiss(id), duration);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-[60] flex flex-col items-end gap-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map((t) => {
            const { icon: Icon, className, bar } = TONES[t.tone];
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 24, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 40, scale: 0.95, transition: { duration: 0.2 } }}
                transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                className="surface relative overflow-hidden pointer-events-auto flex items-center gap-3 pl-4 pr-2 py-2.5 rounded-xl text-sm max-w-sm w-full sm:w-auto"
                role="status"
              >
                <motion.span
                  initial={{ scale: 0, rotate: -45 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 15, delay: 0.08 }}
                  className="flex-shrink-0"
                >
                  <Icon size={17} className={className} />
                </motion.span>
                {/* Time left before the toast disappears */}
                <motion.span
                  aria-hidden
                  className={`absolute bottom-0 left-0 h-0.5 w-full origin-left ${bar}`}
                  initial={{ scaleX: 1 }}
                  animate={{ scaleX: 0 }}
                  transition={{ duration: t.duration / 1000, ease: 'linear' }}
                />
                <span className="text-slate-200 flex-1">{t.message}</span>
                {t.action && (
                  <button
                    onClick={() => {
                      t.action.onClick();
                      dismiss(t.id);
                    }}
                    className="px-2.5 py-1 rounded-lg text-indigo-300 hover:text-white hover:bg-white/10 font-semibold transition-colors"
                  >
                    {t.action.label}
                  </button>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
};

export default ToastProvider;
