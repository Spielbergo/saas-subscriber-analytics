// Generic horizontal bar list — used for device, country, and landing
// page breakdowns across both GA4 and Search Console, so each new
// breakdown is a few lines of mapping rather than a new chart component.
export function BarList({
  items,
  valueLabel,
}: {
  items: { label: string; value: number; sub?: string }[];
  valueLabel?: string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted">No data in this window yet.</p>;
  }

  const max = Math.max(...items.map((i) => i.value), 1);

  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((item) => (
        <li key={item.label} className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate" title={item.label}>
              {item.label}
            </span>
            <span className="shrink-0 text-muted">
              {item.value.toLocaleString()}
              {valueLabel ? ` ${valueLabel}` : ""}
              {item.sub ? (
                <span className="ml-1.5 text-xs">{item.sub}</span>
              ) : null}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${Math.max((item.value / max) * 100, 2)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
