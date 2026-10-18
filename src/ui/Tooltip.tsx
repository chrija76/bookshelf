import { useEffect, useRef } from 'react';
import { useStore } from '../store.ts';
import type { Library } from '../types.ts';

export const stars = (n: number) => (n > 0 ? '★'.repeat(n) + '☆'.repeat(5 - n) : '');

/** Title, author and stars next to the pointer while hovering a book. */
export function Tooltip({ library }: { library: Library }) {
  const hovered = useStore((s) => s.hovered);
  const focused = useStore((s) => s.focused);
  const ref = useRef<HTMLDivElement>(null);
  const book = hovered && !focused ? library.books.find((b) => b.id === hovered) : undefined;

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      // Keep it on screen: flip to the left of the pointer near the right edge.
      const flip = e.clientX > window.innerWidth - 300;
      el.style.transform = `translate(${e.clientX + (flip ? -16 : 16)}px, ${e.clientY + 18}px) translateX(${flip ? '-100%' : '0'})`;
    };
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, []);

  useEffect(() => {
    document.body.style.cursor = book ? 'pointer' : '';
  }, [book]);

  return (
    <div ref={ref} className={`tooltip${book ? ' visible' : ''}`} aria-hidden>
      {book && (
        <>
          <div className="tt-title">{book.title.replace(/\s*\(.*?\)\s*$/, '')}</div>
          <div className="tt-author">{book.author}</div>
          {book.rating > 0 && <div className="tt-stars">{stars(book.rating)}</div>}
        </>
      )}
    </div>
  );
}
