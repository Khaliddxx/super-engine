/**
 * Lightweight skeleton primitives. The shimmer comes from the `.skeleton`
 * class in globals.css; these components are just sized boxes.
 */

export function SkeletonLine({ className = "h-4 w-full" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card p-4 space-y-3">
      <SkeletonLine className="h-4 w-2/3" />
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLine key={i} className={`h-3 w-${i === lines - 1 ? "1/2" : "full"}`} />
      ))}
    </div>
  );
}

export function SkeletonRowList({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card p-4 flex items-center gap-3">
          <SkeletonLine className="h-3 w-6 shrink-0" />
          <div className="flex-1 space-y-2">
            <SkeletonLine className="h-4 w-3/4" />
            <SkeletonLine className="h-3 w-1/2" />
          </div>
          <SkeletonLine className="h-4 w-4 rounded-full shrink-0" />
        </div>
      ))}
    </div>
  );
}
