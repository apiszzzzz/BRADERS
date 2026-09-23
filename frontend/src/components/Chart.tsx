// Minimal dual-line trend chart using react-native-svg.
import { useState } from "react";
import { LayoutChangeEvent, View } from "react-native";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";

import { useTheme } from "@/src/theme";

type Point = { date: string; sales: number; profit: number };

export function TrendChart({ data, height = 150 }: { data: Point[]; height?: number }) {
  const { colors } = useTheme();
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);

  const pad = 8;
  const innerW = Math.max(0, w - pad * 2);
  const innerH = height - pad * 2;
  const max = Math.max(1, ...data.map((d) => Math.max(d.sales, d.profit)));
  const n = data.length;

  const x = (i: number) => pad + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => pad + innerH - (v / max) * innerH;

  const line = (key: "sales" | "profit") =>
    data.map((d, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(d[key]).toFixed(1)}`).join(" ");

  return (
    <View onLayout={onLayout} style={{ height }}>
      {w > 0 ? (
        <Svg width={w} height={height}>
          {[0.25, 0.5, 0.75].map((g) => (
            <Line key={g} x1={pad} y1={pad + innerH * g} x2={w - pad} y2={pad + innerH * g}
              stroke={colors.divider} strokeWidth={1} />
          ))}
          <Path d={line("sales")} stroke={colors.brandPrimary} strokeWidth={2.5} fill="none" />
          <Path d={line("profit")} stroke={colors.success} strokeWidth={2.5} fill="none" />
          {data.map((d, i) => (
            <Circle key={i} cx={x(i)} cy={y(d.sales)} r={2.5} fill={colors.brandPrimary} />
          ))}
        </Svg>
      ) : null}
    </View>
  );
}

export function BarChart({ data, height = 150, color }: {
  data: { label: string; value: number }[]; height?: number; color?: string;
}) {
  const { colors } = useTheme();
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  const pad = 8;
  const innerW = Math.max(0, w - pad * 2);
  const innerH = height - pad * 2;
  const max = Math.max(1, ...data.map((d) => d.value));
  const n = data.length || 1;
  const gap = 6;
  const bw = Math.max(4, (innerW - gap * (n - 1)) / n);
  return (
    <View onLayout={onLayout} style={{ height }}>
      {w > 0 ? (
        <Svg width={w} height={height}>
          {data.map((d, i) => {
            const h = (d.value / max) * innerH;
            return (
              <Rect key={i} x={pad + i * (bw + gap)} y={pad + innerH - h} width={bw} height={Math.max(2, h)}
                rx={3} fill={color || colors.brandPrimary} />
            );
          })}
        </Svg>
      ) : null}
    </View>
  );
}
