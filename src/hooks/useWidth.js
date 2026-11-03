import { useEffect, useRef, useState } from 'react';

/** Width of an element, followed as it resizes: [ref to put on it, width in pixels]. */
export const useWidth = () => {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
};
