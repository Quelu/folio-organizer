import { useCallback, useEffect, useState } from 'react';

/**
 * Shows a long list by chunks, the next one once the sentinel element comes into view.
 * Remount the list (key) when it changes to start again from the first chunk.
 * @returns {{ limit: number, remaining: number, showMore: () => void, setSentinel: (el: Element|null) => void }}
 *   setSentinel: callback ref for the element at the end of the list
 */
export const useChunks = (length, step = 60) => {
  const [limit, setLimit] = useState(step);
  const [sentinel, setSentinel] = useState(null);
  const remaining = Math.max(0, length - limit);
  const showMore = useCallback(() => setLimit((l) => l + step), [step]);

  // Observed again after each chunk: a sentinel still in view asks for the next one
  useEffect(() => {
    if (!sentinel || remaining === 0) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) showMore();
      },
      { rootMargin: '800px 0px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, limit, remaining, showMore]);

  return { limit, remaining, showMore, setSentinel };
};
