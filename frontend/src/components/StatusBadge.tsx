const STATUS: Record<string, string> = {
  running: "bg-blue-100 text-blue-700 border-blue-200",
  done:    "bg-emerald-100 text-emerald-700 border-emerald-200",
  error:   "bg-rose-100 text-rose-700 border-rose-200",
};

export function StatusBadge({ status }: { status: string }) {
  const cls = STATUS[status] ?? "bg-slate-100 text-slate-600 border-slate-200";
  return (
    <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full border ${cls}`}>
      {status}
    </span>
  );
}
