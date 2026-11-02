// Quick-entry syntax for captures. Details typed at the end of a jot fill in fields:
//   "Call dentist fri !high #health" -> due Friday, High priority, Health area.
// Only trailing words are read, so a word like "fri" mid-sentence stays in the title.
// supabase/schema.sql has the same rules in parse_capture() for the iPhone Shortcut.

import { addDays, daysBetween } from './dates.js';

export const AREAS = ['Home', 'Health', 'Finance', 'Family', 'Projects', 'Work'];

const PRIORITY = { '!': 'High', '!high': 'High', '!critical': 'Critical', '!crit': 'Critical', '!low': 'Low', '!someday': 'Someday', '!normal': 'Normal' };
const RELATIVE = { today: 0, tod: 0, tomorrow: 1, tmrw: 1, tmr: 1 };
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const FILLER = ['on', 'by', 'due'];

function weekdayIndex(word) {
  const w = word.replace(/\.$/, '');
  if (w.length < 3) return -1;
  return WEEKDAYS.findIndex((d) => w.startsWith(d) && ('sunday monday tuesday wednesday thursday friday saturday'.includes(w) || w === 'tues' || w === 'thur' || w === 'thurs' || w.length === 3));
}

function dayOfWeek(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function parseDate(word, today) {
  word = word.replace(/\.$/, '');
  if (Object.hasOwn(RELATIVE, word)) return addDays(today, RELATIVE[word]);
  const wd = weekdayIndex(word);
  if (wd >= 0) return addDays(today, (wd - dayOfWeek(today) + 7) % 7);
  const m = word.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  let year = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : Number(today.slice(0, 4));
  const valid = (y) => {
    const dt = new Date(Date.UTC(y, month - 1, day));
    return dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
  };
  if (month < 1 || month > 12 || !valid(year)) return null;
  const pad = (n) => String(n).padStart(2, '0');
  let s = year + '-' + pad(month) + '-' + pad(day);
  if (!m[3] && daysBetween(today, s) < 0 && valid(year + 1)) s = year + 1 + '-' + pad(month) + '-' + pad(day);
  return s;
}

export function parseCapture(text, today) {
  const words = text.trim().split(/\s+/);
  const out = { title: text.trim(), next_due: null, priority: null, area: null };
  let end = words.length;
  while (end > 1) {
    const w = words[end - 1].toLowerCase();
    if (Object.hasOwn(PRIORITY, w) && !out.priority) { out.priority = PRIORITY[w]; end--; continue; }
    if (w.startsWith('#') && !out.area) {
      const area = AREAS.find((a) => a.toLowerCase() === w.slice(1));
      if (area) { out.area = area; end--; continue; }
    }
    if (!out.next_due) {
      const due = parseDate(w, today);
      if (due) { out.next_due = due; end--; continue; }
    }
    break;
  }
  if (out.next_due) while (end > 1 && FILLER.includes(words[end - 1].toLowerCase())) end--;
  if (end < words.length) out.title = words.slice(0, end).join(' ');
  return out;
}
