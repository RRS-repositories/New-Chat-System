import { useEffect, useRef, useState } from 'react';
import { isLookedAt } from '../utils/notify.ts';

/**
 * Is the chat being looked at right now? = the tab is visible and has focus.
 * `notLookingSince` is when it stopped (null while looked at), for the away timer.
 */
export function useAttention() {
  const read = () => isLookedAt({ hidden: document.hidden, focused: document.hasFocus() });
  const [looking, setLooking] = useState(read);
  const lookingRef = useRef(looking);
  const notLookingSince = useRef<number | null>(looking ? null : Date.now());
  useEffect(() => {
    const update = () => {
      const v = read();
      if (v === lookingRef.current) return;
      lookingRef.current = v;
      notLookingSince.current = v ? null : Date.now();
      setLooking(v);
    };
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    update();
    return () => {
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { looking, lookingRef, notLookingSince };
}
