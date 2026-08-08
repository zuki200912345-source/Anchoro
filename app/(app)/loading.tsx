// Skeleton while a signed-in page loads: three chalk planes, subtle pulse.
// prefers-reduced-motion is handled globally in globals.css.
export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="space-y-4 pt-2">
      <div className="plane h-28 animate-pulse" />
      <div className="plane h-44 animate-pulse" />
      <div className="plane h-28 animate-pulse" />
      <span className="sr-only">Loading</span>
    </div>
  );
}
