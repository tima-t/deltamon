"use client";

import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import type { AccountingDaily } from "@deltamon/shared";
import {
  fundingValue,
  historyDate,
  historyUsd,
  historyPercent,
  strategyRuns,
  type FundingView,
  type StrategyReturnPoint,
} from "@/lib/vaultHistory";

function useChartWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(240, Math.round(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function scale(values: number[], height: number) {
  let low = Math.min(0, ...values);
  let high = Math.max(0, ...values);
  if (high === low) high = 0.01;
  const rough = (high - low) / 3;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / magnitude;
  const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * magnitude;
  low = Math.floor(low / step) * step;
  high = Math.ceil(high / step) * step;
  const ticks = Array.from(
    { length: Math.round((high - low) / step) + 1 },
    (_, i) => low + i * step,
  );
  return { ticks, y: (value: number) => 22 + ((high - value) / (high - low)) * (height - 58) };
}

function DateAxis({
  days,
  x,
  height,
  width,
}: {
  days: AccountingDaily[];
  x: (index: number) => number;
  height: number;
  width: number;
}) {
  const count = Math.min(days.length, width < 420 ? 3 : 4);
  const indices = [
    ...new Set(
      Array.from({ length: count }, (_, i) =>
        Math.round((i * (days.length - 1)) / Math.max(1, count - 1)),
      ),
    ),
  ];
  return indices.map((index, i) => (
    <text
      key={index}
      x={x(index)}
      y={height - 8}
      textAnchor={i === 0 ? "start" : i === indices.length - 1 ? "end" : "middle"}
    >
      {historyDate(days[index]!.date)}
    </text>
  ));
}

interface ChartProps {
  days: AccountingDaily[];
  selected: number;
  onSelect: (index: number) => void;
}

function chooseDay(
  event: PointerEvent<SVGRectElement>,
  width: number,
  left: number,
  plotWidth: number,
  count: number,
  onSelect: ChartProps["onSelect"],
) {
  const bounds = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
  const localX = ((event.clientX - bounds.left) * width) / bounds.width;
  onSelect(Math.max(0, Math.min(count - 1, Math.floor(((localX - left) / plotWidth) * count))));
}

export function ReturnChart({
  days,
  points,
  selected,
  onSelect,
}: ChartProps & { points: (StrategyReturnPoint | null)[] }) {
  const { ref, width } = useChartWidth();
  const height = 266,
    left = 55,
    right = 32,
    plotWidth = width - left - right;
  const x = (index: number) => left + ((index + 0.5) / Math.max(1, days.length)) * plotWidth;
  const runs = strategyRuns(points);
  const values = runs.flat().map((point) => point.value);
  const { ticks, y } = scale(values, height);
  const value = points[selected]?.value ?? null;
  const last = runs.at(-1)?.at(-1);
  const hasHistory = values.length > 0;
  const description = hasHistory
    ? "Funding and estimated staking income earned to each date, as a percentage of all USDC ever deposited into the vault. It excludes price PnL and trading fees, so it is strategy income rather than a depositor's net return. Days with no recorded income are gaps rather than flat lines. Use the inspect-date slider below for individual readings."
    : "No recorded strategy-income readings in this period.";
  return (
    <div className="performance-chart-wrap performance-return-chart" ref={ref}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ height }}
        className="performance-chart"
        role="img"
        aria-label={description}
      >
        <title>Cumulative vault return</title>
        <desc>{description}</desc>
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              className="performance-gridline"
              x1={left}
              x2={width - right}
              y1={y(tick)}
              y2={y(tick)}
            />
            {hasHistory && (
              <text x={left - 9} y={y(tick) + 4} textAnchor="end">
                {historyPercent(tick).replace(/^\+/, "")}
              </text>
            )}
          </g>
        ))}
        <DateAxis days={days} x={x} height={height} width={width} />
        {runs.map((run, index) => {
          const path = run
            .map((point, i) => `${i === 0 ? "M" : "L"}${x(point.index)},${y(point.value)}`)
            .join(" ");
          return (
            <g key={index}>
              {run.length > 1 && (
                <path
                  d={`${path} L${x(run.at(-1)!.index)},${y(0)} L${x(run[0]!.index)},${y(0)} Z`}
                  className="performance-return-fill"
                />
              )}
              <path d={path} fill="none" className="performance-return-line" />
              {run.length === 1 && (
                <circle cx={x(run[0]!.index)} cy={y(run[0]!.value)} r={3.5} fill="var(--ink)" />
              )}
            </g>
          );
        })}
        {last && (
          <g>
            <circle cx={x(last.index)} cy={y(last.value)} r={3.5} fill="var(--ink)" />
            <text
              className="performance-end-label"
              x={x(last.index)}
              y={Math.max(13, y(last.value) - 12)}
              textAnchor="end"
            >
              {historyPercent(last.value)}
            </text>
          </g>
        )}
        {hasHistory && selected >= 0 && (
          <line
            className="performance-guide"
            x1={x(selected)}
            x2={x(selected)}
            y1={22}
            y2={height - 36}
          />
        )}
        {value !== null && (
          <circle
            cx={x(selected)}
            cy={y(value)}
            r={4.5}
            fill="var(--monad)"
            stroke="var(--surface)"
            strokeWidth={2}
          />
        )}
        {days.length > 0 && (
          <rect
            x={left}
            y={18}
            width={plotWidth}
            height={height - 50}
            fill="transparent"
            onPointerMove={(event) =>
              chooseDay(event, width, left, plotWidth, days.length, onSelect)
            }
            onPointerDown={(event) =>
              chooseDay(event, width, left, plotWidth, days.length, onSelect)
            }
          />
        )}
      </svg>
      {!hasHistory && (
        <p className="performance-chart-empty">
          A return line will appear
          <br />
          as sdMON share values are recorded.
        </p>
      )}
      {values.length === 1 && (
        <p className="performance-chart-start">
          One recorded day.
          <br />
          Earlier readings are unavailable.
        </p>
      )}
    </div>
  );
}

export function IncomeChart({
  days,
  selected,
  onSelect,
  view,
}: ChartProps & { view: FundingView }) {
  const { ref, width } = useChartWidth();
  const patternId = useId().replace(/:/g, "");
  const height = 196,
    left = 76,
    right = 24,
    plotWidth = width - left - right;
  const slot = plotWidth / Math.max(1, days.length);
  const x = (index: number) => left + slot * (index + 0.5);
  const barWidth = Math.max(2, Math.min(28, slot * 0.72));
  const values = days.flatMap((day) => {
    const stake = day.stakingEstimatedUsd,
      funding = fundingValue(day, view);
    return [
      ...(stake !== null ? [stake] : []),
      ...(funding !== null ? [funding < 0 ? funding : (stake ?? 0) + funding] : []),
    ];
  });
  const { ticks, y } = scale(values, height);
  const hasIncome = values.length > 0;
  const description = `Daily estimated MON staking income and ${view === "observed" ? "observed funding earnings" : "settled funding payments"} in USD. Funding paid is below zero. Hatching identifies partial observed days; missing readings have a cross below the date. Use the inspect-date slider below.`;
  return (
    <div className="performance-chart-wrap" ref={ref}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ height }}
        className="performance-chart performance-income-chart"
        role="img"
        aria-label={description}
      >
        <title>Daily strategy income</title>
        <defs>
          <pattern id={patternId} width={5} height={5} patternUnits="userSpaceOnUse">
            <path d="M-1,1 L1,-1 M0,5 L5,0 M4,6 L6,4" stroke="var(--surface)" strokeWidth={1} />
          </pattern>
        </defs>
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              className={Math.abs(tick) < 1e-12 ? "performance-zero-line" : "performance-gridline"}
              x1={left}
              x2={width - right}
              y1={y(tick)}
              y2={y(tick)}
            />
            {hasIncome && (
              <text x={left - 10} y={y(tick) + 4} textAnchor="end">
                {historyUsd(tick)}
              </text>
            )}
          </g>
        ))}
        <DateAxis days={days} x={x} height={height} width={width} />
        {days.map((day, index) => {
          const stake = day.stakingEstimatedUsd,
            funding = fundingValue(day, view);
          const partialStake = day.stakingCoveredSeconds < 86_400;
          const partialFunding = view === "observed" && day.fundingObservedSeconds < 86_400;
          const bars = [
            {
              id: "stake",
              value: stake,
              bottom: 0,
              color: "var(--exposure-long)",
              partial: partialStake,
            },
            {
              id: "funding",
              value: funding,
              bottom: funding !== null && funding >= 0 ? (stake ?? 0) : 0,
              color: "var(--exposure-short)",
              partial: partialFunding,
            },
          ];
          return (
            <g key={day.date}>
              {bars.map((bar) => {
                if (bar.value === null) return null;
                if (bar.value === 0)
                  return (
                    <line
                      key={bar.id}
                      x1={x(index) - barWidth / 2}
                      x2={x(index) + barWidth / 2}
                      y1={y(bar.bottom)}
                      y2={y(bar.bottom)}
                      stroke={bar.color}
                      strokeWidth={1.5}
                    />
                  );
                const barHeight = Math.max(
                  1.5,
                  Math.abs(y(bar.bottom + bar.value) - y(bar.bottom)),
                );
                const top = bar.value > 0 ? y(bar.bottom) - barHeight : y(bar.bottom);
                return (
                  <g key={bar.id}>
                    <rect
                      x={x(index) - barWidth / 2}
                      y={top}
                      width={barWidth}
                      height={barHeight}
                      fill={bar.color}
                    />
                    {bar.partial && barHeight > 3 && (
                      <rect
                        x={x(index) - barWidth / 2}
                        y={top}
                        width={barWidth}
                        height={barHeight}
                        fill={`url(#${patternId})`}
                        opacity={0.7}
                      />
                    )}
                  </g>
                );
              })}
              {stake === null && funding === null && (
                <path
                  d={`M${x(index) - 2},${height - 31} l4,4 m-4,0 l4,-4`}
                  className="performance-missing-mark"
                />
              )}
            </g>
          );
        })}
        {hasIncome && selected >= 0 && (
          <line
            className="performance-guide"
            x1={x(selected)}
            x2={x(selected)}
            y1={20}
            y2={height - 36}
          />
        )}
        {days.length > 0 && (
          <rect
            x={left}
            y={18}
            width={plotWidth}
            height={height - 50}
            fill="transparent"
            onPointerMove={(event) =>
              chooseDay(event, width, left, plotWidth, days.length, onSelect)
            }
            onPointerDown={(event) =>
              chooseDay(event, width, left, plotWidth, days.length, onSelect)
            }
          />
        )}
      </svg>
      {!hasIncome && (
        <p className="performance-chart-empty">
          Daily income is still being recorded.
          <br />
          Missing readings stay unavailable.
        </p>
      )}
    </div>
  );
}
