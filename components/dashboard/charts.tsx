"use client";

// Dashboard charts. Recharts, styled from the token palette only: ink for
// the data, slate for chrome, flag for the live emphasis, gold for rewards.
// Single-series charts throughout — identity never rides on color alone.

import { useState } from "react";
import {
  Bar,
  BarChart,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CATEGORY_LABELS, type Category } from "@/lib/types";

const INK = "#16190f";
const SLATE = "#5d6852";
const FLAG = "#e01b54";

function PlaneTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: { value?: number | string }[];
  label?: string | number;
  unit?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="plane-sm px-2.5 py-1.5 text-xs">
      {label !== undefined && <p className="text-slate">{label}</p>}
      <p className="num">
        {payload[0].value}
        {unit ?? ""}
      </p>
    </div>
  );
}

// Tiny trend line for the hero score. No axes, no grid.
export function ScoreSparkline({
  points,
}: {
  points: { date: string; score: number }[];
}) {
  if (points.length < 2) return null;
  return (
    <div className="h-10 w-28" aria-hidden>
      <ResponsiveContainer>
        <LineChart data={points} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
          <Line
            type="monotone"
            dataKey="score"
            stroke={FLAG}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CategoryRadar({
  ratings,
}: {
  ratings: { category: Category; rating: number }[];
}) {
  const data = ratings.map((r) => ({
    label: CATEGORY_LABELS[r.category],
    rating: r.rating,
  }));
  const min = Math.min(...ratings.map((r) => r.rating));
  const max = Math.max(...ratings.map((r) => r.rating));
  return (
    <div className="h-64 w-full" role="img" aria-label="rating by category">
      <ResponsiveContainer>
        <RadarChart data={data} outerRadius="70%">
          <PolarGrid stroke={SLATE} strokeOpacity={0.3} />
          <PolarAngleAxis
            dataKey="label"
            tick={{ fill: SLATE, fontSize: 11 }}
          />
          <Radar
            dataKey="rating"
            stroke={FLAG}
            strokeWidth={2}
            fill={FLAG}
            fillOpacity={0.15}
            isAnimationActive={false}
          />
          <Tooltip content={<PlaneTooltip />} />
        </RadarChart>
      </ResponsiveContainer>
      <p className="sr-only">
        {data.map((d) => `${d.label} ${d.rating}`).join(", ")}; range {min} to {max}
      </p>
    </div>
  );
}

const RANGES = [
  { key: "30d", days: 30 },
  { key: "90d", days: 90 },
  { key: "all", days: Infinity },
] as const;

export function ScoreOverTime({
  points,
}: {
  points: { date: string; score: number }[];
}) {
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("90d");
  const days = RANGES.find((r) => r.key === range)!.days;
  const cutoff = Date.now() - days * 86_400_000;
  const visible =
    days === Infinity
      ? points
      : points.filter((p) => new Date(p.date).getTime() >= cutoff);

  return (
    <div>
      <div role="radiogroup" aria-label="time range" className="flex gap-2">
        {RANGES.map((r) => (
          <button
            key={r.key}
            role="radio"
            aria-checked={range === r.key}
            onClick={() => setRange(r.key)}
            className={`num rounded-full border px-3 py-1 text-xs ${
              range === r.key
                ? "border-ink bg-ink text-chalk"
                : "border-slate/50 text-slate hover:border-ink hover:text-ink"
            }`}
          >
            {r.key}
          </button>
        ))}
      </div>
      <div className="mt-3 h-48 w-full">
        {visible.length < 2 ? (
          <p className="pt-8 text-center text-sm text-slate">
            Play a few sessions and the line draws itself.
          </p>
        ) : (
          <ResponsiveContainer>
            <LineChart
              data={visible}
              margin={{ top: 8, right: 8, bottom: 0, left: -18 }}
            >
              <XAxis
                dataKey="date"
                tick={{ fill: SLATE, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: SLATE, strokeOpacity: 0.3 }}
                minTickGap={40}
                tickFormatter={(d: string) => d.slice(5)}
              />
              <YAxis
                tick={{ fill: SLATE, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={46}
                domain={["dataMin - 20", "dataMax + 20"]}
              />
              <Tooltip content={<PlaneTooltip />} />
              <Line
                type="monotone"
                dataKey="score"
                stroke={INK}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: FLAG, stroke: "none" }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// Per-category percentage bars, one hue — same measure across categories.
export function CategoryBars({
  rows,
  hue = "ink",
}: {
  rows: { category: Category; value: number }[];
  hue?: "ink" | "gold";
}) {
  const data = rows.map((r) => ({
    label: CATEGORY_LABELS[r.category].slice(0, 7),
    value: Math.round(r.value),
  }));
  return (
    <div className="h-32 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: -28 }}>
          <XAxis
            dataKey="label"
            tick={{ fill: SLATE, fontSize: 9 }}
            tickLine={false}
            axisLine={{ stroke: SLATE, strokeOpacity: 0.3 }}
            interval={0}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fill: SLATE, fontSize: 9 }}
            tickLine={false}
            axisLine={false}
            ticks={[0, 50, 100]}
          />
          <Tooltip content={<PlaneTooltip unit="%" />} cursor={{ fill: SLATE, fillOpacity: 0.08 }} />
          <Bar
            dataKey="value"
            fill={hue === "gold" ? "#f0b429" : INK}
            radius={[4, 4, 0, 0]}
            maxBarSize={22}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
