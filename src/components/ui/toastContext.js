import { createContext, useContext } from 'react';

export const ToastContext = createContext(() => {});

/** Returns notify({ message, tone?, action?: { label, onClick }, duration? }) */
export const useToast = () => useContext(ToastContext);
