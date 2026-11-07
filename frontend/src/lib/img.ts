import { getImage } from 'astro:assets';

export interface Responsive { src: string; srcset?: string; sizes?: string; width?: number; height?: number }

/**
 * A photo from the API, resized at build time into a few widths (served from /_astro/, cached for a year).
 * If the API host can't be reached or the file can't be read, the original URL is used as before.
 */
export async function responsive(url: string, widths: number[], sizes: string): Promise<Responsive> {
  try {
    const img = await getImage({ src: url, inferSize: true, widths, format: 'webp', quality: 80 });
    if (!img.srcSet?.attribute) return { src: url };
    // With inferSize, the options carry the original photo's dimensions.
    const width = Number(img.options.width) || undefined;
    const height = Number(img.options.height) || undefined;
    return { src: img.src, srcset: img.srcSet.attribute, sizes, width, height };
  } catch (e) {
    console.warn(`[symmetry] image not optimized, using original: ${url}`, (e as Error).message);
    return { src: url };
  }
}
