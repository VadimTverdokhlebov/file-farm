import { useRef } from 'react';

// A thin overview of the whole run. The thumb is the visible window and shrinks
// as the data outgrows it. Dragging it to the right edge follows the latest point.
export function ChartScrollBar({
  total,
  window,
  start,
  onScroll,
  label,
}: {
  total: number;
  window: number;
  start: number;
  onScroll: (start: number | null) => void;
  label: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const grabRef = useRef<number | null>(null);
  const span = Math.max(total, window, 1);
  const lastStart = Math.max(0, span - window);
  const thumbRatio = Math.min(1, window > 0 ? window / span : 1);
  const leftRatio = lastStart <= 0 ? 0 : Math.min(Math.max(start / span, 0), 1 - thumbRatio);

  const apply = (clientX: number, grabRatio: number) => {
    const track = trackRef.current;
    if (!track) {
      return;
    }
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }
    const next = ((clientX - rect.left) / rect.width - grabRatio) * span;
    const clamped = Math.min(Math.max(next, 0), lastStart);
    onScroll(clamped >= lastStart ? null : clamped);
  };

  return (
    <div
      ref={trackRef}
      className="load-chart-scroll"
      role="scrollbar"
      aria-label={label}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={Math.round(lastStart)}
      aria-valuenow={Math.round(start)}
      onPointerDown={(event) => {
        const track = trackRef.current;
        if (!track) {
          return;
        }
        const rect = track.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const leftPx = leftRatio * rect.width;
        const thumbPx = thumbRatio * rect.width;
        const onThumb = x >= leftPx && x <= leftPx + thumbPx;
        grabRef.current = onThumb ? (x - leftPx) / rect.width : thumbRatio / 2;
        track.setPointerCapture(event.pointerId);
        apply(event.clientX, grabRef.current);
      }}
      onPointerMove={(event) => {
        if (grabRef.current == null) {
          return;
        }
        apply(event.clientX, grabRef.current);
      }}
      onPointerUp={() => {
        grabRef.current = null;
      }}
      onPointerCancel={() => {
        grabRef.current = null;
      }}
    >
      <span className="load-chart-scroll-thumb" style={{ left: `${leftRatio * 100}%`, width: `${thumbRatio * 100}%` }} />
    </div>
  );
}
