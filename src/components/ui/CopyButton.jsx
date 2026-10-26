import { useEffect, useRef, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { useToast } from './toastContext';
import { copyText } from '../../utils/clipboard';

const CopyButton = ({ text, label = 'Copier', toast = 'Copié', className = 'btn-secondary px-3 py-1.5' }) => {
  const notify = useToast();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const copy = async () => {
    if (!(await copyText(text))) {
      notify({ tone: 'error', message: 'Copie impossible' });
      return;
    }
    setCopied(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 2000);
    notify({ tone: 'success', message: toast });
  };

  return (
    <button onClick={copy} disabled={!text} className={`${className} ${copied ? 'text-emerald-300' : ''}`}>
      {copied ? <Check size={15} /> : <Copy size={15} />}
      {copied ? 'Copié' : label}
    </button>
  );
};

export default CopyButton;
