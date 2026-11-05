/**
 * Live admin: the shell polls /admin/stats and announces what changed, so lists update by themselves.
 * Pages subscribe with useLive('orders' | 'messages', reload) and quietly reload when told.
 */
import { useEffect, useRef } from 'preact/hooks';

export type LiveTopic = 'orders' | 'messages';
const EVENT = 'symmetry:live';

export const announce = (topic: LiveTopic) => window.dispatchEvent(new CustomEvent(EVENT, { detail: topic }));

/** Call `reload` whenever `topic` changes elsewhere (new order, payment update, new message). */
export function useLive(topic: LiveTopic | LiveTopic[], reload: () => void) {
  const fn = useRef(reload);
  fn.current = reload;
  const topics = Array.isArray(topic) ? topic : [topic];
  useEffect(() => {
    const on = (e: Event) => { if (topics.includes((e as CustomEvent).detail)) fn.current(); };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [topics.join()]);
}
