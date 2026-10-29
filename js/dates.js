// Dates are local calendar days stored as 'YYYY-MM-DD' strings. All math runs on
// whole days in UTC so a date never shifts across a time zone boundary.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');

export function todayStr(d = new Date()) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function toDayNum(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 864e5;
}

function fromDayNum(n) {
  const d = new Date(n * 864e5);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

// Whole days from a to b (negative when b is earlier).
export function daysBetween(a, b) {
  return toDayNum(b) - toDayNum(a);
}

export function addDays(s, n) {
  return fromDayNum(toDayNum(s) + n);
}

// Adds months, clamping to the last day of a shorter month (Jan 31 + 1 month = Feb 28).
export function addMonths(s, months) {
  const [y, m, d] = s.split('-').map(Number);
  const total = m - 1 + months;
  const year = y + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return year + '-' + pad(month + 1) + '-' + pad(Math.min(d, last));
}

export function fmtDate(s) {
  const [, m, d] = s.split('-').map(Number);
  return MONTHS[m - 1] + ' ' + d;
}

export const FREQUENCIES = ['Daily', 'Weekly', 'Biweekly', 'Monthly', 'Quarterly', 'Semiannual', 'Annual', 'Custom'];

export function stepDue(s, frequency, intervalDays) {
  switch (frequency) {
    case 'Daily': return addDays(s, 1);
    case 'Weekly': return addDays(s, 7);
    case 'Biweekly': return addDays(s, 14);
    case 'Monthly': return addMonths(s, 1);
    case 'Quarterly': return addMonths(s, 3);
    case 'Semiannual': return addMonths(s, 6);
    case 'Annual': return addMonths(s, 12);
    default: return addDays(s, Math.max(1, Number(intervalDays) || 7));
  }
}

// Next due date after finishing a cycle: steps from the previous due date (not
// from today) at least once, then keeps stepping until it is today or later.
export function rollForward(due, frequency, intervalDays, today) {
  let next = stepDue(due, frequency, intervalDays);
  while (daysBetween(today, next) < 0) next = stepDue(next, frequency, intervalDays);
  return next;
}

// Due status is computed, never stored.
export function dueInfo(item, today) {
  if (item.stage === 'Complete') {
    return { n: null, label: item.completed_date ? 'Done ' + fmtDate(item.completed_date) : 'Done', cls: 'due-none', row: 'done' };
  }
  if (!item.next_due) return { n: null, label: 'No date', cls: 'due-none', row: '' };
  const n = daysBetween(today, item.next_due);
  if (n < 0) return { n, label: -n + 'd overdue', cls: 'due-over', row: 'over' };
  if (n === 0) return { n, label: 'Due today', cls: 'due-today', row: 'over' };
  if (n <= 7) return { n, label: 'In ' + n + 'd', cls: 'due-soon', row: 'soon' };
  return { n, label: fmtDate(item.next_due), cls: 'due-none', row: '' };
}
