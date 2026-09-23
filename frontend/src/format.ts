// Formatting helpers (IDR + WIB dates), all Bahasa Indonesia.
export function rupiah(n: number | null | undefined, opts: { sign?: boolean } = {}): string {
  const v = Math.round(Number(n || 0));
  const neg = v < 0;
  const abs = Math.abs(v).toLocaleString("id-ID");
  const s = `Rp${abs}`;
  if (neg) return `-${s}`;
  if (opts.sign && v > 0) return `+${s}`;
  return s;
}

export function num(n: number | null | undefined): string {
  const v = Number(n || 0);
  return (Math.round(v * 100) / 100).toLocaleString("id-ID");
}

export function pct(n: number | null | undefined): string {
  return `${num(n)}%`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const DAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

function toWIB(iso: string): Date {
  return new Date(iso);
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return "-";
  const d = toWIB(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return "-";
  const d = toWIB(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${hh}:${mm}`;
}

export function fmtTime(iso?: string | null): string {
  if (!iso) return "-";
  const d = toWIB(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function fmtDay(iso?: string | null): string {
  if (!iso) return "-";
  const d = toWIB(iso);
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const PAYMENT_LABELS: Record<string, string> = {
  cash: "Tunai", qris: "QRIS", transfer: "Transfer", other: "Lainnya",
};

export const STATUS_LABELS: Record<string, string> = {
  UNPAID: "Belum Bayar", PAYMENT_PENDING: "Menunggu", PAID: "Lunas",
  FAILED: "Gagal", EXPIRED: "Kedaluwarsa", REFUNDED: "Refund", CANCELLED: "Dibatalkan",
  completed: "Selesai", pending_payment: "Menunggu", void: "Dibatalkan", cancelled: "Dibatalkan",
};
