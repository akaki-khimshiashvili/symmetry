/**
 * Sale end date in words: "15 ნოემბრის ჩათვლით" / "Until 15 November".
 * The year is added only when it isn't the current one. Safe to import in browser scripts (no Node APIs).
 */
const KA_GENITIVE = ['იანვრის', 'თებერვლის', 'მარტის', 'აპრილის', 'მაისის', 'ივნისის', 'ივლისის', 'აგვისტოს', 'სექტემბრის', 'ოქტომბრის', 'ნოემბრის', 'დეკემბრის'];
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function saleEndText(endsAt: string | undefined | null, lang: string, now = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(endsAt || '');
  if (!m) return '';
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const year = y !== now.getFullYear() ? ` ${y}` : '';
  if (lang === 'en') return `Until ${d} ${EN_MONTHS[mo]}${year}`;
  // Georgian puts the year first: "2027 წლის 15 ნოემბრის ჩათვლით".
  return `${year ? `${y} წლის ` : ''}${d} ${KA_GENITIVE[mo]} ჩათვლით`;
}
