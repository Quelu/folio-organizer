import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';

/**
 * Small dropdown menu.
 * items: [{ label, icon, onClick, danger }] — null entries are skipped, 'divider' draws a separator.
 */
const Menu = ({ trigger, items, align = 'right', label = 'Actions' }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <div
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            setOpen((o) => !o);
          }
        }}
      >
        {trigger}
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            className={`surface absolute z-30 mt-1.5 min-w-[190px] rounded-xl p-1 ${
              align === 'right' ? 'right-0' : 'left-0'
            }`}
            role="menu"
          >
            {items.filter(Boolean).map((item, i) =>
              item === 'divider' ? (
                <div key={`d${i}`} className="my-1 h-px bg-white/5" />
              ) : (
                <button
                  key={item.label}
                  role="menuitem"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(false);
                    item.onClick();
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                    item.danger
                      ? 'text-rose-300 hover:bg-rose-500/10'
                      : 'text-slate-300 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  {item.icon && <item.icon size={15} className="flex-shrink-0 opacity-80" />}
                  {item.label}
                </button>
              )
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Menu;
