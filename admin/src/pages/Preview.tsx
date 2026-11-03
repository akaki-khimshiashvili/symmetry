import { useMemo } from 'preact/hooks';
import { relief } from '../../../frontend/src/lib/relief';

/** The same parametric relief the public site draws when a product has no photo yet. */
export function Preview({ pattern, small = false, ratio = 0.8 }: { pattern: string; small?: boolean; ratio?: number }) {
  const svg = useMemo(
    () => relief({ pattern, width: small ? 240 : 800, height: Math.round((small ? 240 : 800) / ratio), density: small ? 0.5 : 1, uid: `pv${pattern}${small ? 's' : ''}${Math.round(ratio * 100)}` }),
    [pattern, small, ratio],
  );
  return <div class={`preview ${small ? 'sm' : ''}`} style={small ? undefined : { aspectRatio: String(ratio) }} dangerouslySetInnerHTML={{ __html: svg }} />;
}
