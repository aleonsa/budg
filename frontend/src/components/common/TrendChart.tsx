import { useId, useState, type MouseEvent } from 'react'
import { cn } from '@/lib/utils'

/**
 * Lightweight multi-series SVG line chart.
 *
 * No chart library in the repo by design — this covers the stats view needs:
 * evenly spaced points, gridlines, hover crosshair with values, and a legend.
 */

export type ChartColor = 'green' | 'red' | 'blue' | 'purple' | 'yellow'

const COLOR_VALUES: Record<ChartColor, string> = {
  green: 'hsl(var(--color-green))',
  red: 'hsl(var(--color-red))',
  blue: 'hsl(var(--color-blue))',
  purple: 'hsl(var(--color-purple))',
  yellow: 'hsl(var(--color-yellow))',
}

export interface ChartSeries {
  name: string
  color: ChartColor
  values: number[]
  /** Render the area under the line with a soft fill. */
  filled?: boolean
}

interface TrendChartProps {
  labels: string[]
  series: ChartSeries[]
  formatValue: (value: number) => string
  ariaLabel: string
  height?: number
  className?: string
}

const WIDTH = 640
const PAD_LEFT = 8
const PAD_RIGHT = 8
const PAD_TOP = 12
const PAD_BOTTOM = 22

export function TrendChart({
  labels,
  series,
  formatValue,
  ariaLabel,
  height = 200,
  className,
}: TrendChartProps) {
  const gradientId = useId()
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const count = labels.length
  const values = series.flatMap((s) => s.values)
  const rawMin = Math.min(0, ...values)
  const rawMax = Math.max(...values)
  const span = rawMax - rawMin || 1

  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT
  const plotHeight = height - PAD_TOP - PAD_BOTTOM
  const x = (index: number) =>
    PAD_LEFT + (count <= 1 ? plotWidth / 2 : (index / (count - 1)) * plotWidth)
  const y = (value: number) => PAD_TOP + plotHeight - ((value - rawMin) / span) * plotHeight

  const handleMove = (event: MouseEvent<SVGSVGElement>) => {
    if (count === 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const relative = (event.clientX - rect.left) / rect.width
    const index = Math.round(relative * (count - 1))
    setHoverIndex(Math.min(Math.max(index, 0), count - 1))
  }

  if (count === 0 || series.length === 0) return null

  return (
    <div className={cn('w-full', className)}>
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="w-full touch-none"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        {series.map((s) =>
          s.filled ? (
            <linearGradient key={s.name} id={`${gradientId}-${s.name}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLOR_VALUES[s.color]} stopOpacity={0.22} />
              <stop offset="100%" stopColor={COLOR_VALUES[s.color]} stopOpacity={0.02} />
            </linearGradient>
          ) : null,
        )}

        {[0, 0.5, 1].map((t) => {
          const gy = PAD_TOP + plotHeight * t
          const value = rawMax - span * t
          return (
            <g key={t}>
              <line
                x1={PAD_LEFT}
                x2={WIDTH - PAD_RIGHT}
                y1={gy}
                y2={gy}
                className="stroke-border"
                strokeWidth={1}
              />
              <text x={PAD_LEFT} y={gy - 3} className="fill-muted-foreground text-[9px]">
                {formatValue(value)}
              </text>
            </g>
          )
        })}

        {series.map((s) => {
          const path = s.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(v)}`).join(' ')
          const areaPath =
            s.filled && count > 0
              ? `${path} L${x(count - 1)},${PAD_TOP + plotHeight} L${x(0)},${PAD_TOP + plotHeight} Z`
              : null
          return (
            <g key={s.name}>
              {areaPath && <path d={areaPath} fill={`url(#${gradientId}-${s.name})`} />}
              <path
                d={path}
                fill="none"
                stroke={COLOR_VALUES[s.color]}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          )
        })}

        {hoverIndex !== null && (
          <g>
            <line
              x1={x(hoverIndex)}
              x2={x(hoverIndex)}
              y1={PAD_TOP}
              y2={PAD_TOP + plotHeight}
              className="stroke-foreground/30"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            {series.map((s) => (
              <circle
                key={s.name}
                cx={x(hoverIndex)}
                cy={y(s.values[hoverIndex] ?? 0)}
                r={3.5}
                fill={COLOR_VALUES[s.color]}
                className="stroke-background"
                strokeWidth={1.5}
              />
            ))}
          </g>
        )}

        <text x={PAD_LEFT} y={height - 6} className="fill-muted-foreground text-[9px]">
          {labels[0]}
        </text>
        <text
          x={WIDTH - PAD_RIGHT}
          y={height - 6}
          textAnchor="end"
          className="fill-muted-foreground text-[9px]"
        >
          {labels[count - 1]}
        </text>
      </svg>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        {hoverIndex !== null ? (
          <>
            <span className="text-[11px] font-medium text-muted-foreground">
              {labels[hoverIndex]}
            </span>
            {series.map((s) => (
              <span key={s.name} className="flex items-center gap-1 text-[11px]">
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: COLOR_VALUES[s.color] }}
                />
                <span className="text-muted-foreground">{s.name}</span>
                <span className="font-medium tabular-nums">
                  {formatValue(s.values[hoverIndex] ?? 0)}
                </span>
              </span>
            ))}
          </>
        ) : (
          series.map((s) => (
            <span key={s.name} className="flex items-center gap-1 text-[11px]">
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: COLOR_VALUES[s.color] }}
              />
              <span className="text-muted-foreground">{s.name}</span>
              <span className="font-medium tabular-nums">
                {formatValue(s.values[s.values.length - 1] ?? 0)}
              </span>
            </span>
          ))
        )}
      </div>
    </div>
  )
}
