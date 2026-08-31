'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Hand-rolled SVG charts, sized in real pixels rather than a scaled viewBox.
 *
 * A `viewBox` that stretches would scale the type along with the plot, so the
 * same chart would carry 8px labels in the 350px Firefox sidebar and oversized
 * ones in a full tab. Measuring the container instead keeps text, ticks, and
 * stroke widths at a fixed physical size at every width.
 *
 * See PLAN.md §8 risk #7 for why this replaced Recharts.
 */
function useContainerWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current!;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

function ChartFrame({
  height,
  children,
}: {
  height: number;
  children: (width: number) => React.ReactNode;
}) {
  const [ref, width] = useContainerWidth();

  return (
    <div ref={ref} style={{ height }}>
      {/* First paint has no measurement yet; the ResizeObserver fills it in. */}
      {width > 0 && (
        <svg width={width} height={height} role="img">
          {children(width)}
        </svg>
      )}
    </div>
  );
}

const AXIS = 'rgba(120, 105, 90, 0.16)';

function polarPoint(cx: number, cy: number, r: number, fraction: number) {
  // Start at 12 o'clock and sweep clockwise.
  const angle = fraction * 2 * Math.PI - Math.PI / 2;
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)] as const;
}

export function DonutChart({
  slices,
  height = 200,
}: {
  slices: Array<{ key: string; label: string; usd: number; color: string }>;
  height?: number;
}) {
  const total = slices.reduce((sum, slice) => sum + slice.usd, 0);

  return (
    <ChartFrame height={height}>
      {(width) => {
        const cx = width / 2;
        const cy = height / 2;
        const outer = Math.min(cx, cy) - 4;
        const inner = outer * 0.62;
        let start = 0;

        return (
          <g>
            {slices.map((slice) => {
              const fraction = total > 0 ? slice.usd / total : 0;
              const end = start + fraction;
              const [x0, y0] = polarPoint(cx, cy, outer, start);
              const [x1, y1] = polarPoint(cx, cy, outer, end);
              const [x2, y2] = polarPoint(cx, cy, inner, end);
              const [x3, y3] = polarPoint(cx, cy, inner, start);
              const large = fraction > 0.5 ? 1 : 0;
              start = end;

              // A full-circle arc has identical endpoints and would render as
              // nothing, so a lone slice is drawn as two stacked rings instead.
              if (fraction >= 1) {
                return (
                  <g key={slice.key}>
                    <circle cx={cx} cy={cy} r={(outer + inner) / 2} fill="none"
                      stroke={slice.color} strokeWidth={outer - inner} />
                  </g>
                );
              }

              return (
                <path
                  key={slice.key}
                  fill={slice.color}
                  d={`M ${x0} ${y0} A ${outer} ${outer} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${inner} ${inner} 0 ${large} 0 ${x3} ${y3} Z`}
                >
                  <title>{slice.label}</title>
                </path>
              );
            })}
          </g>
        );
      }}
    </ChartFrame>
  );
}

export function LineChart({
  points,
  formatValue,
  formatLabel,
  height = 200,
}: {
  points: Array<{ label: string; value: number }>;
  formatValue: (value: number) => string;
  formatLabel: (label: string) => string;
  height?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A dead-flat series would divide by zero; give it a band to sit inside.
  const span = max - min || Math.abs(max) || 1;
  const shown = points[active ?? points.length - 1];

  return (
    <div className="space-y-2">
      <p className="text-sm tabular-nums">
        <span className="font-medium">{formatValue(shown.value)}</span>{' '}
        <span className="text-muted-foreground">{formatLabel(shown.label)}</span>
      </p>
      <ChartFrame height={height}>
        {(width) => {
          const padY = 8;
          const plotH = height - padY * 2;
          const x = (index: number) =>
            points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
          const y = (value: number) => padY + (1 - (value - min) / span) * plotH;
          const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.value)}`).join(' ');
          const activeIndex = active ?? points.length - 1;

          return (
            <g>
              {[0, 0.5, 1].map((fraction) => (
                <line key={fraction} x1={0} x2={width}
                  y1={padY + fraction * plotH} y2={padY + fraction * plotH} stroke={AXIS} />
              ))}
              <path d={path} fill="none" stroke="#3B7A57" strokeWidth={2}
                strokeLinejoin="round" strokeLinecap="round" />
              <circle cx={x(activeIndex)} cy={y(points[activeIndex].value)} r={4} fill="#3B7A57" />
              {/* One transparent hit column per point — a touch-sized target,
                  unlike a hover-only tooltip. */}
              {points.map((point, index) => (
                <rect
                  key={point.label}
                  x={x(index) - width / points.length / 2}
                  width={width / points.length}
                  y={0}
                  height={height}
                  fill="transparent"
                  onPointerDown={() => setActive(index)}
                  onPointerEnter={() => setActive(index)}
                />
              ))}
            </g>
          );
        }}
      </ChartFrame>
    </div>
  );
}

export function StackedBarChart({
  points,
  categories,
  colors,
  formatValue,
  formatLabel,
  height = 200,
}: {
  points: Array<{ label: string; values: Record<string, number> }>;
  categories: string[];
  colors: string[];
  formatValue: (value: number) => string;
  formatLabel: (label: string) => string;
  height?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const totals = points.map((point) =>
    categories.reduce((sum, category) => sum + (point.values[category] ?? 0), 0),
  );
  const max = Math.max(...totals) || 1;
  const activeIndex = active ?? points.length - 1;

  return (
    <div className="space-y-2">
      <p className="text-sm tabular-nums">
        <span className="font-medium">{formatValue(totals[activeIndex])}</span>{' '}
        <span className="text-muted-foreground">{formatLabel(points[activeIndex].label)}</span>
      </p>
      <ChartFrame height={height}>
        {(width) => {
          const slot = width / points.length;
          const barW = Math.min(slot * 0.62, 36);

          return (
            <g>
              <line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} stroke={AXIS} />
              {points.map((point, index) => {
                const cx = slot * index + slot / 2;
                let cursor = height;

                return (
                  <g key={point.label}
                    onPointerDown={() => setActive(index)}
                    onPointerEnter={() => setActive(index)}
                  >
                    <rect x={slot * index} width={slot} y={0} height={height} fill="transparent" />
                    {categories.map((category, categoryIndex) => {
                      const value = point.values[category] ?? 0;
                      const h = (value / max) * (height - 8);
                      cursor -= h;

                      return h <= 0 ? null : (
                        <rect
                          key={category}
                          x={cx - barW / 2}
                          y={cursor}
                          width={barW}
                          height={h}
                          fill={colors[categoryIndex % colors.length]}
                          opacity={index === activeIndex ? 1 : 0.7}
                        />
                      );
                    })}
                  </g>
                );
              })}
            </g>
          );
        }}
      </ChartFrame>
    </div>
  );
}
