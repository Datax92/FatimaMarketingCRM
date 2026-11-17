/**
 * Banks and wallets an account can be. The account only stores its name; the bank is
 * recognised from it, so "UBL Current" and "ubl" both show the UBL badge.
 *
 * Badges are drawn in each brand's colour. To use an official logo instead, put the
 * file in `public/banks/` and name it in `logo` (e.g. `logo: 'ubl.svg'`).
 */

export interface Bank {
  id: string;
  name: string;
  /** Short mark drawn on the badge. */
  mark: string;
  bg: string;
  fg: string;
  /** Second brand colour, for the card's accent. */
  accent?: string;
  match: RegExp;
  kind: 'bank' | 'wallet' | 'cash';
  logo?: string;
}

export const BANKS: Bank[] = [
  { id: 'ubl', name: 'UBL', mark: 'UBL', bg: '#0060A9', fg: '#fff', accent: '#4FA3E0', match: /\bubl\b|united bank/i, kind: 'bank' },
  { id: 'hbl', name: 'HBL', mark: 'HBL', bg: '#00826A', fg: '#fff', accent: '#3CC4A4', match: /\bhbl\b|habib bank(?! al)/i, kind: 'bank' },
  { id: 'meezan', name: 'Meezan Bank', mark: 'M', bg: '#6B1F5E', fg: '#fff', accent: '#B85AA6', match: /meezan/i, kind: 'bank' },
  { id: 'mcb', name: 'MCB', mark: 'MCB', bg: '#00783E', fg: '#fff', accent: '#F2C230', match: /\bmcb\b|muslim commercial/i, kind: 'bank' },
  { id: 'alfalah', name: 'Bank Alfalah', mark: 'BAF', bg: '#D7141E', fg: '#fff', accent: '#FF6A6F', match: /alfalah|\bbafl?\b/i, kind: 'bank' },
  { id: 'allied', name: 'Allied Bank', mark: 'ABL', bg: '#0B3B8C', fg: '#fff', accent: '#E2343C', match: /allied|\babl\b/i, kind: 'bank' },
  { id: 'askari', name: 'Askari Bank', mark: 'AKB', bg: '#004C97', fg: '#fff', accent: '#2DA44E', match: /askari/i, kind: 'bank' },
  { id: 'alhabib', name: 'Bank Al Habib', mark: 'BAH', bg: '#0E7A3F', fg: '#fff', accent: '#9BD36A', match: /al.?habib/i, kind: 'bank' },
  { id: 'faysal', name: 'Faysal Bank', mark: 'FBL', bg: '#1A1A1A', fg: '#F4B400', accent: '#F4B400', match: /faysal|faisal bank/i, kind: 'bank' },
  { id: 'nbp', name: 'National Bank', mark: 'NBP', bg: '#006B3F', fg: '#fff', accent: '#7CC242', match: /\bnbp\b|national bank/i, kind: 'bank' },
  { id: 'scb', name: 'Standard Chartered', mark: 'SC', bg: '#0473EA', fg: '#fff', accent: '#38D200', match: /standard chartered|\bscb\b/i, kind: 'bank' },
  { id: 'js', name: 'JS Bank', mark: 'JS', bg: '#1C3F94', fg: '#fff', accent: '#E31B23', match: /\bjs bank\b|^js\b/i, kind: 'bank' },
  { id: 'habibmetro', name: 'HabibMetro', mark: 'HM', bg: '#E1251B', fg: '#fff', accent: '#0057A8', match: /habib ?metro/i, kind: 'bank' },
  { id: 'bop', name: 'Bank of Punjab', mark: 'BOP', bg: '#0F7B3B', fg: '#fff', accent: '#F7B500', match: /bank of punjab|\bbop\b/i, kind: 'bank' },
  { id: 'dib', name: 'Dubai Islamic', mark: 'DIB', bg: '#005A3C', fg: '#fff', accent: '#C9A227', match: /dubai islamic|\bdib\b/i, kind: 'bank' },
  { id: 'soneri', name: 'Soneri Bank', mark: 'SB', bg: '#F2A900', fg: '#3B2A00', accent: '#C27C00', match: /soneri/i, kind: 'bank' },
  { id: 'easypaisa', name: 'EasyPaisa', mark: 'ep', bg: '#25B566', fg: '#fff', accent: '#8BE0A8', match: /easy ?paisa/i, kind: 'wallet' },
  { id: 'jazzcash', name: 'JazzCash', mark: 'JC', bg: '#E1171E', fg: '#FFD200', accent: '#FFD200', match: /jazz ?cash/i, kind: 'wallet' },
  { id: 'sadapay', name: 'SadaPay', mark: 'SP', bg: '#05B2A5', fg: '#fff', accent: '#7EE6DC', match: /sada ?pay/i, kind: 'wallet' },
  { id: 'nayapay', name: 'NayaPay', mark: 'NP', bg: '#F26522', fg: '#fff', accent: '#FFB38A', match: /naya ?pay/i, kind: 'wallet' },
  { id: 'cash', name: 'Cash', mark: '₨', bg: '#2E7D32', fg: '#fff', accent: '#A5D6A7', match: /\bcash\b|in hand|drawer|petty/i, kind: 'cash' },
];

/** The bank an account name refers to, if any. */
export function bankFor(name: string): Bank | null {
  return BANKS.find((b) => b.match.test(name)) ?? null;
}

/** A steady colour for an account that is not a known bank. */
export function colourFor(name: string): string {
  const palette = ['#3B5BA5', '#7A4FB5', '#0F7C8C', '#B5562E', '#2F7D4E', '#A33A6B', '#5B6B7A'];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}
