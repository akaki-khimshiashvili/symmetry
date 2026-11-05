import qrcode from 'qrcode-generator';

/** QR code as a crisp, scalable SVG (always dark on white so every phone camera reads it). */
export function qrSvg(text: string, label = 'QR code') {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const q = 4; // quiet zone, in modules
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
    }
  }
  const size = n + q * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="${label}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/** SQLite UTC timestamp → local Tbilisi date and time. */
export function fmtWhen(s: string | null | undefined, lang: string) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  if (isNaN(+d)) return s;
  // Numbers come from Intl (for the Tbilisi time zone); Georgian month names are written out
  // because many browsers ship without Georgian locale data.
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Tbilisi', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map((p) => [p.type, p.value]),
  );
  const m = Number(parts.month) - 1;
  const months = lang === 'en' ? MONTHS_EN : MONTHS_KA;
  return `${Number(parts.day)} ${months[m]} ${parts.year}, ${parts.hour}:${parts.minute}`;
}

const MONTHS_KA = ['იანვარი', 'თებერვალი', 'მარტი', 'აპრილი', 'მაისი', 'ივნისი', 'ივლისი', 'აგვისტო', 'სექტემბერი', 'ოქტომბერი', 'ნოემბერი', 'დეკემბერი'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const fmtGel = (n: number) =>
  `₾ ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n).replace(/,/g, ' ')}`;
