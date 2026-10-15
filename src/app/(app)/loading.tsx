export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-48 animate-pulse rounded-lg bg-gray-200" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-gray-100" />
        ))}
      </div>
      <div className="h-56 animate-pulse rounded-2xl bg-gray-100" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="h-64 animate-pulse rounded-2xl bg-gray-100 lg:col-span-3" />
        <div className="h-64 animate-pulse rounded-2xl bg-gray-100 lg:col-span-2" />
      </div>
    </div>
  );
}
