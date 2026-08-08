"use client";

// Feature H3 — the calibration curve. Confidence stated before answering (H1)
// against the accuracy actually achieved in that band (H2).
//
// Read it against the dashed diagonal: a point below the line means the rating
// ran ahead of the result in that band, a point above means the working held up
// better than the rating did. Points, not verdicts — the sentence underneath the
// chart on the page comes from calibrationVerdict, and it names bands, never the
// student (H6).
//
// Colours are the token palette, restated as hex because Recharts writes SVG
// presentation attributes: ink for the data, slate at 0.3 for the grid, flag for
// the reference line. Nothing else.
//
// The chart is decoration for screen readers; the table below it is the data,
// so both stay in sync and the numbers are reachable without sight of the plot.

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CalibrationBin } from "@/lib/research/calibration";
import { MIN_BIN_SAMPLE } from "@/lib/research/calibration";

const INK = "#16190f";
const SLATE = "#5d6852";
const FLAG = "#e01b54";

const TICKS = [0, 25, 50, 75, 100];

function BinTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload?: CalibrationBin }[];
}) {
  const bin = payload?.[0]?.payload;
  if (!active || !bin) return null;
  return (
    <div className="plane-sm px-2.5 py-1.5 text-xs">
      <p className="text-slate">{bin.rangeLabel} band</p>
      <p className="num">
        said {bin.meanConfidence}% · right {bin.actualAccuracy}%
      </p>
      <p className="num text-slate">
        {bin.n} {bin.n === 1 ? "item" : "items"}
      </p>
    </div>
  );
}

export interface CalibrationChartProps {
  bins: CalibrationBin[];
}

export function CalibrationChart({ bins }: CalibrationChartProps) {
  if (bins.length === 0) {
    return (
      <p className="text-sm text-slate">
        No confidence ratings recorded yet, so there is no curve to draw. Rate
        how sure you are before you answer and the bands fill in.
      </p>
    );
  }

  return (
    <div>
      <div className="h-56 w-full sm:h-64" aria-hidden>
        <ResponsiveContainer>
          <LineChart
            data={bins}
            margin={{ top: 8, right: 12, bottom: 4, left: -20 }}
          >
            <CartesianGrid stroke={SLATE} strokeOpacity={0.3} />
            <XAxis
              type="number"
              dataKey="meanConfidence"
              domain={[0, 100]}
              ticks={TICKS}
              tick={{ fill: SLATE, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: SLATE, strokeOpacity: 0.3 }}
              tickFormatter={(v: number) => `${v}%`}
            />
            <YAxis
              type="number"
              domain={[0, 100]}
              ticks={TICKS}
              tick={{ fill: SLATE, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={46}
              tickFormatter={(v: number) => `${v}%`}
            />
            <ReferenceLine
              segment={[
                { x: 0, y: 0 },
                { x: 100, y: 100 },
              ]}
              stroke={FLAG}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              ifOverflow="hidden"
            />
            <Tooltip content={<BinTooltip />} />
            <Line
              type="linear"
              dataKey="actualAccuracy"
              stroke={INK}
              strokeWidth={2}
              dot={{ r: 4, fill: INK, stroke: INK }}
              activeDot={{ r: 5, fill: FLAG, stroke: "none" }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-1 text-xs text-slate">
        Across the bottom: the confidence you stated. Up the side: how often you
        were right. The dashed line is where the two match exactly.
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">
            Confidence bands, what you predicted, and what you scored
          </caption>
          <thead>
            <tr className="border-b border-ink/20 text-xs text-slate">
              <th scope="col" className="py-1.5 pr-2 font-semibold">
                Band
              </th>
              <th scope="col" className="py-1.5 pr-2 font-semibold">
                You said
              </th>
              <th scope="col" className="py-1.5 pr-2 font-semibold">
                You were right
              </th>
              <th scope="col" className="py-1.5 font-semibold">
                Items
              </th>
            </tr>
          </thead>
          <tbody>
            {bins.map((bin) => (
              <tr key={bin.bin} className="border-b border-ink/10 last:border-0">
                <th scope="row" className="num py-1.5 pr-2 font-normal">
                  {bin.rangeLabel}
                </th>
                <td className="num py-1.5 pr-2">{bin.meanConfidence}%</td>
                <td className="num py-1.5 pr-2">{bin.actualAccuracy}%</td>
                <td className="num py-1.5">
                  {bin.n}
                  {bin.n < MIN_BIN_SAMPLE ? (
                    <span className="ml-1.5 font-body text-xs text-slate">
                      too few to read
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
