import Ionicons from "@react-native-vector-icons/ionicons";
import { useQuery } from "@tanstack/react-query";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { API, buildQuery, getToken } from "@/src/api";
import { apiFetch } from "@/src/api";
import { useAuth } from "@/src/auth";
import { BarChart } from "@/src/components/Chart";
import { useFeedback } from "@/src/components/feedback";
import { Header } from "@/src/components/Header";
import { Button, Card, Loading, Row } from "@/src/components/ui";
import { PAYMENT_LABELS, pct, rupiah } from "@/src/format";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

const RANGES = [
  { key: "today", label: "Harian" },
  { key: "week", label: "Mingguan" },
  { key: "month", label: "Bulanan" },
];

export default function Reports() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { toast } = useFeedback();
  const [range, setRange] = useState("month");
  const [tab, setTab] = useState<"finance" | "sales">(user?.role === "owner" ? "finance" : "sales");
  const isOwner = user?.role === "owner";

  const { data: fin, isLoading: finLoading } = useQuery({
    queryKey: ["report-fin", range], queryFn: () => apiFetch(`/reports/financial${buildQuery({ range_name: range })}`), enabled: isOwner,
  });
  const { data: sal, isLoading: salLoading } = useQuery({
    queryKey: ["report-sales", range], queryFn: () => apiFetch(`/reports/sales${buildQuery({ range_name: range })}`),
  });

  const download = async (type: string) => {
    try {
      const token = await getToken();
      const url = `${API}/reports/export${buildQuery({ type, range_name: range })}`;
      if (Platform.OS === "web") {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `braders-${type}.csv`;
        a.click();
        toast("CSV diunduh", "success");
      } else {
        const path = `${FileSystem.cacheDirectory}braders-${type}.csv`;
        const res = await FileSystem.downloadAsync(url, path, { headers: { Authorization: `Bearer ${token}` } });
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(res.uri);
        else toast("File tersimpan: " + res.uri, "info");
      }
    } catch (e: any) {
      toast("Gagal ekspor: " + e.message, "error");
    }
  };

  const payData = Object.entries(sal?.by_payment || {}).map(([k, v]) => ({ label: PAYMENT_LABELS[k] || k, value: v as number }));
  const catData = Object.entries(sal?.by_category || {}).map(([k, v]) => ({ label: k, value: v as number }));
  const hourData = Object.entries(sal?.by_hour || {}).sort().map(([k, v]) => ({ label: k, value: v as number }));

  return (
    <View style={s.container}>
      <Header title="Laporan" back subtitle="Keuangan & penjualan" />
      <View style={s.tabRow}>
        {isOwner ? (
          <Pressable onPress={() => setTab("finance")} style={[s.tabBtn, tab === "finance" && s.tabActive]} testID="tab-finance"><Text style={[s.tabText, tab === "finance" && s.tabTextActive]}>Keuangan</Text></Pressable>
        ) : null}
        <Pressable onPress={() => setTab("sales")} style={[s.tabBtn, tab === "sales" && s.tabActive]} testID="tab-sales"><Text style={[s.tabText, tab === "sales" && s.tabTextActive]}>Penjualan</Text></Pressable>
      </View>
      <View style={s.chipRow}>
        {RANGES.map((r) => (
          <Pressable key={r.key} onPress={() => setRange(r.key)} testID={`report-range-${r.key}`} style={[s.chip, range === r.key && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }]}>
            <Text style={[s.chipText, range === r.key && { color: colors.onBrandPrimary }]}>{r.label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 24, gap: spacing.md }} showsVerticalScrollIndicator={false}>
        {tab === "finance" && isOwner ? (
          finLoading ? <Loading /> : (
            <>
              <Card>
                <Text style={s.cardTitle}>Laba Rugi (P&L)</Text>
                <View style={{ height: spacing.sm }} />
                <PL l="Penjualan Kotor" r={rupiah(fin?.gross_sales)} />
                <PL l="Diskon" r={`-${rupiah(fin?.discounts)}`} muted />
                <PL l="Penjualan Bersih" r={rupiah(fin?.net_sales)} bold />
                <View style={s.gap} />
                <PL l="HPP (COGS)" r={`-${rupiah(fin?.cogs)}`} muted />
                <PL l="Laba Kotor" r={rupiah(fin?.gross_profit)} bold tone="success" />
                <View style={s.gap} />
                <PL l="Beban Operasional" r={`-${rupiah(fin?.opex_total)}`} muted />
                <PL l="Laba Bersih" r={rupiah(fin?.net_profit)} bold tone={((fin?.net_profit ?? 0) >= 0) ? "success" : "error"} />
              </Card>

              <Row style={{ gap: spacing.md }}>
                <Card style={s.miniCard}><Text style={s.miniL}>Margin Kotor</Text><Text style={s.miniV}>{pct(fin?.gross_margin)}</Text></Card>
                <Card style={s.miniCard}><Text style={s.miniL}>Margin Bersih</Text><Text style={s.miniV}>{pct(fin?.net_margin)}</Text></Card>
              </Row>
              <Row style={{ gap: spacing.md }}>
                <Card style={s.miniCard}><Text style={s.miniL}>Transaksi</Text><Text style={s.miniV}>{fin?.transactions}</Text></Card>
                <Card style={s.miniCard}><Text style={s.miniL}>Rata-rata Nota</Text><Text style={s.miniV}>{rupiah(fin?.avg_transaction)}</Text></Card>
              </Row>

              {(fin?.qris?.fee ?? 0) > 0 ? (
                <Card>
                  <Text style={s.cardTitle}>Rincian QRIS</Text>
                  <View style={{ height: spacing.sm }} />
                  <PL l="Penjualan QRIS (Kotor)" r={rupiah((fin?.qris?.net_received ?? 0) + (fin?.qris?.fee ?? 0))} />
                  <PL l="Biaya QRIS (MDR)" r={`-${rupiah(fin?.qris?.fee)}`} muted />
                  <PL l="Diterima Bersih" r={rupiah(fin?.qris?.net_received)} bold tone="success" />
                </Card>
              ) : null}

              <Card>
                <Text style={s.cardTitle}>Ekspor Laporan (CSV)</Text>
                <View style={s.exportGrid}>
                  {[["pnl", "Laba Rugi"], ["sales", "Penjualan"], ["expenses", "Pengeluaran"], ["inventory", "Inventaris"], ["purchases", "Pembelian"], ["products", "Produk"]].map(([t, l]) => (
                    <Pressable key={t} onPress={() => download(t)} style={s.exportBtn} testID={`export-${t}`}>
                      <Ionicons name="download-outline" size={16} color={colors.brandPrimary} />
                      <Text style={s.exportText}>{l}</Text>
                    </Pressable>
                  ))}
                </View>
              </Card>
            </>
          )
        ) : (
          salLoading ? <Loading /> : (
            <>
              <Card style={{ backgroundColor: colors.brandPrimary }}>
                <Text style={s.salLabel}>Total Penjualan</Text>
                <Text style={s.salVal}>{rupiah(sal?.totals?.total_sales)}</Text>
                <Row style={{ gap: spacing.xl, marginTop: spacing.sm }}>
                  <View><Text style={s.salSubL}>Transaksi</Text><Text style={s.salSubV}>{sal?.totals?.transactions}</Text></View>
                  <View><Text style={s.salSubL}>Item</Text><Text style={s.salSubV}>{sal?.totals?.units_sold}</Text></View>
                  <View><Text style={s.salSubL}>Rata-rata</Text><Text style={s.salSubV}>{rupiah(sal?.totals?.avg_order_value)}</Text></View>
                </Row>
              </Card>

              <Card>
                <Text style={s.cardTitle}>Produk Terlaris</Text>
                <View style={{ height: spacing.sm }} />
                {(sal?.best_sellers || []).length === 0 ? <Text style={s.empty}>Belum ada data</Text> : null}
                {(sal?.best_sellers || []).map((p: any, i: number) => (
                  <Row key={p.name} style={s.bestRow}>
                    <Text style={s.rank}>{i + 1}</Text>
                    <Text style={s.bestName}>{p.name}</Text>
                    <View style={{ alignItems: "flex-end" }}><Text style={s.bestQty}>{p.qty}x</Text><Text style={s.bestRev}>{rupiah(p.revenue)}</Text></View>
                  </Row>
                ))}
              </Card>

              {payData.length ? (
                <Card>
                  <Text style={s.cardTitle}>Penjualan per Metode</Text>
                  <View style={{ height: spacing.sm }} />
                  {payData.map((p) => (
                    <Row key={p.label} style={s.distRow}><Text style={s.distL}>{p.label}</Text><Text style={s.distR}>{rupiah(p.value)}</Text></Row>
                  ))}
                </Card>
              ) : null}

              {catData.length ? (
                <Card>
                  <Text style={s.cardTitle}>Penjualan per Kategori</Text>
                  <View style={{ height: spacing.sm }} />
                  {catData.map((p) => (
                    <Row key={p.label} style={s.distRow}><Text style={s.distL}>{p.label}</Text><Text style={s.distR}>{rupiah(p.value)}</Text></Row>
                  ))}
                </Card>
              ) : null}

              {hourData.length ? (
                <Card>
                  <Text style={s.cardTitle}>Penjualan per Jam</Text>
                  <View style={{ height: spacing.sm }} />
                  <BarChart data={hourData} height={130} />
                  <Row style={{ justifyContent: "space-between", marginTop: 4 }}>
                    <Text style={s.hourLabel}>{hourData[0]?.label}</Text>
                    <Text style={s.hourLabel}>{hourData[hourData.length - 1]?.label}</Text>
                  </Row>
                </Card>
              ) : null}
            </>
          )
        )}
      </ScrollView>
    </View>
  );
}

function PL({ l, r, bold, muted, tone }: { l: string; r: string; bold?: boolean; muted?: boolean; tone?: "success" | "error" }) {
  const s = useStyles();
  const { colors } = useTheme();
  const color = tone === "success" ? colors.success : tone === "error" ? colors.error : bold ? colors.onSurface : muted ? colors.muted : colors.onSurfaceSecondary;
  return (
    <Row style={[s.plRow, bold && s.plBold]}>
      <Text style={[s.plL, bold && { fontWeight: "800", color: colors.onSurface }]}>{l}</Text>
      <Text style={[s.plR, { color }, bold && { fontWeight: "900", fontSize: 16 }]}>{r}</Text>
    </Row>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.surface },
  tabRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  tabBtn: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: radius.md, backgroundColor: c.surfaceTertiary },
  tabActive: { backgroundColor: c.surfaceInverse },
  tabText: { fontSize: 14, fontWeight: "700", color: c.onSurfaceTertiary },
  tabTextActive: { color: c.onSurfaceInverse },
  chipRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  chip: { paddingHorizontal: 16, height: 36, borderRadius: radius.pill, justifyContent: "center", backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.border },
  chipText: { fontSize: 14, fontWeight: "700", color: c.onSurfaceTertiary },
  cardTitle: { fontSize: 16, fontWeight: "800", color: c.onSurface },
  plRow: { justifyContent: "space-between", paddingVertical: 5 },
  plBold: { borderTopWidth: 1, borderTopColor: c.divider, marginTop: 4, paddingTop: 8 },
  plL: { fontSize: 14, color: c.onSurfaceSecondary },
  plR: { fontSize: 14, fontWeight: "700" },
  gap: { height: 6 },
  miniCard: { flex: 1 },
  miniL: { fontSize: 13, color: c.muted },
  miniV: { fontSize: 18, fontWeight: "900", color: c.onSurface, marginTop: 2 },
  exportGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  exportBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.md, backgroundColor: c.brandTertiary },
  exportText: { fontSize: 13, fontWeight: "700", color: c.onBrandTertiary },
  salLabel: { fontSize: 14, color: "#FFE9CC", fontWeight: "600" },
  salVal: { fontSize: 30, fontWeight: "900", color: "#FFFFFF", marginTop: 2 },
  salSubL: { fontSize: 12, color: "#FFE9CC" },
  salSubV: { fontSize: 16, fontWeight: "800", color: "#FFFFFF", marginTop: 2 },
  bestRow: { gap: 12, alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.divider },
  rank: { fontSize: 14, fontWeight: "900", color: c.brandSecondary, width: 20 },
  bestName: { flex: 1, fontSize: 14, fontWeight: "600", color: c.onSurface },
  bestQty: { fontSize: 14, fontWeight: "800", color: c.onSurface },
  bestRev: { fontSize: 12, color: c.muted },
  distRow: { justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.divider },
  distL: { fontSize: 14, color: c.onSurfaceSecondary },
  distR: { fontSize: 14, fontWeight: "800", color: c.onSurface },
  hourLabel: { fontSize: 11, color: c.muted },
  empty: { fontSize: 14, color: c.muted },
}));
