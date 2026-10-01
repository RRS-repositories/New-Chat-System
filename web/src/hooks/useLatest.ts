import { useRef, type MutableRefObject } from 'react';

/** A ref that always holds the newest value, for callbacks that must not be rebuilt when it changes. */
export function useLatest<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
