import Ionicons from "@react-native-vector-icons/ionicons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch, buildQuery } from "@/src/api";
import { useAuth } from "@/src/auth";
import { TrendChart } from "@/src/components/Chart";
import { Badge, Card, ChipRow, ErrorState, Loading, Row } from "@/src/components/ui";
import { fmtDay, rupiah } from "@/src/format";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

const RANGES = [
  { key: "today", label: "Hari Ini" },
  { key: "yesterday", label: "Kemarin" },
  { key: "week", label: "Minggu Ini" },
  { key: "month", label: "Bulan Ini" },
];

export default function Dashboard() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [range, setRange] = useState("today");

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["dashboard", range],
    queryFn: () => apiFetch(`/dashboard${buildQuery({ range_name: range })}`),
  });

  const isOwner = user?.role === "owner";
  const k = data?.kpis;

  const quickActions = [
    { label: "Penjualan", icon: "add-circle", route: "/pos", show: user?.role !== "staff", color: colors.brandPrimary },
    { label: "Pengeluaran", icon: "wallet", route: "/expenses", show: user?.role !== "staff", color: colors.warning },
    { label: "Stok Masuk", icon: "cube", route: "/purchases", show: true, color: colors.info },
    { label: "Laporan", icon: "bar-chart", route: "/reports", show: user?.role !== "staff", color: colors.success },
  ].filter((a) => a.show);

  return (
    <View style={s.container}>
      <View style={[s.header, { paddingTop: insets.top + spacing.md }]}>
        <Row style={{ justifyContent: "space-between" }}>
          <View>
            <Text style={s.greeting}>Halo, {user?.name?.split(" ")[0] || "BRADERS"} 👋</Text>
            <Text style={s.brandLine}>BRADERS · Churros Lezatoss</Text>
          </View>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{(user?.name || "B")[0].toUpperCase()}</Text>
          </View>
        </Row>
      </View>

      <ChipRow options={RANGES} value={range} onChange={setRange} testIDPrefix="range" />

      {isLoading ? (
        <Loading label="Memuat dasbor…" />
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.brandPrimary} />}
          showsVerticalScrollIndicator={false}
        >
          {data?.settings?.demo_mode ? (
            <Row style={s.demoBanner}>
              <Ionicons name="flask" size={16} color={colors.onBrandTertiary} />
              <Text style={s.demoText}>Menampilkan data demo untuk pengujian</Text>
            </Row>
          ) : null}

          {/* Primary KPI: Sales */}
          <Card style={{ backgroundColor: colors.brandPrimary }}>
            <Text style={s.primaryLabel}>Penjualan {RANGES.find((r) => r.key === range)?.label}</Text>
            <Text style={s.primaryValue} testID="kpi-sales">{rupiah(k?.sales)}</Text>
            <Row style={{ gap: spacing.lg, marginTop: spacing.sm }}>
              <View>
                <Text style={s.primarySub}>Transaksi</Text>
                <Text style={s.primarySubVal} testID="kpi-transactions">{k?.transactions ?? 0}</Text>
              </View>
              <View>
                <Text style={s.primarySub}>Item Terjual</Text>
                <Text style={s.primarySubVal}>{k?.units_sold ?? 0}</Text>
              </View>
              <View>
                <Text style={s.primarySub}>Rata-rata</Text>
                <Text style={s.primarySubVal}>{rupiah(k?.avg_transaction)}</Text>
              </View>
            </Row>
          </Card>

          {/* KPI grid */}
          <View style={s.grid}>
            <MetricCard label="Laba Kotor" value={rupiah(k?.gross_profit)} icon="trending-up" tone="success" testID="kpi-gross" />
            {isOwner ? (
              <MetricCard label="Laba Bersih" value={rupiah(k?.net_profit)} icon="cash" tone={((k?.net_profit ?? 0) >= 0) ? "success" : "error"} testID="kpi-net" />
            ) : (
              <MetricCard label="HPP" value={rupiah(k?.cogs)} icon="pricetag" tone="warning" />
            )}
            <MetricCard label="Pengeluaran" value={rupiah(k?.expenses)} icon="wallet" tone="warning" testID="kpi-expenses" />
            <MetricCard label="Saldo Kas" value={rupiah(k?.cash_balance)} icon="server" tone="info" testID="kpi-cash" />
          </View>

          {/* Quick actions */}
          <Text style={s.sectionTitle}>Aksi Cepat</Text>
          <View style={s.actionsRow}>
            {quickActions.map((a) => (
              <Card key={a.label} style={s.actionCard} onPress={() => router.push(a.route as any)} testID={`quick-${a.label.toLowerCase()}`}>
                <View style={[s.actionIcon, { backgroundColor: a.color }]}>
                  <Ionicons name={a.icon as any} size={22} color="#FFFFFF" />
                </View>
                <Text style={s.actionLabel}>{a.label}</Text>
              </Card>
            ))}
          </View>

          {/* Trend */}
          <Card>
            <Row style={{ justifyContent: "space-between", marginBottom: spacing.sm }}>
              <Text style={s.cardTitle}>Tren 14 Hari</Text>
              <Row style={{ gap: spacing.md }}>
                <Row style={{ gap: 4 }}><View style={[s.dot, { backgroundColor: colors.brandPrimary }]} /><Text style={s.legend}>Penjualan</Text></Row>
                <Row style={{ gap: 4 }}><View style={[s.dot, { backgroundColor: colors.success }]} /><Text style={s.legend}>Laba</Text></Row>
              </Row>
            </Row>
            <TrendChart data={data?.trend || []} />
          </Card>

          {/* Low stock */}
          <Card>
            <Row style={{ justifyContent: "space-between", marginBottom: spacing.sm }}>
              <Text style={s.cardTitle}>Stok Menipis</Text>
              {data?.low_stock?.length ? <Badge label={`${data.low_stock.length} bahan`} tone="error" /> : null}
            </Row>
            {data?.low_stock?.length ? (
              data.low_stock.slice(0, 5).map((i: any) => (
                <Row key={i.id} style={s.lowRow}>
                  <Ionicons name="alert-circle" size={18} color={colors.error} />
                  <Text style={s.lowName}>{i.name}</Text>
                  <Text style={s.lowVal}>{i.stock} / min {i.min_stock} {i.unit}</Text>
                </Row>
              ))
            ) : (
              <Text style={s.emptyLine}>Semua stok aman ✓</Text>
            )}
          </Card>

          {/* Best sellers */}
          <Card>
            <Text style={[s.cardTitle, { marginBottom: spacing.sm }]}>Produk Terlaris</Text>
            {data?.best_sellers?.length ? (
              data.best_sellers.map((p: any, idx: number) => (
                <Row key={p.name} style={s.bestRow}>
                  <View style={[s.rank, idx === 0 && { backgroundColor: colors.brandPrimary }]}>
                    <Text style={[s.rankText, idx === 0 && { color: colors.onBrandPrimary }]}>{idx + 1}</Text>
                  </View>
                  <Text style={s.bestName}>{p.name}</Text>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={s.bestQty}>{p.qty} terjual</Text>
                    <Text style={s.bestRev}>{rupiah(p.revenue)}</Text>
                  </View>
                </Row>
              ))
            ) : (
              <Text style={s.emptyLine}>Belum ada penjualan</Text>
            )}
          </Card>
        </ScrollView>
      )}
    </View>
  );
}

function MetricCard({ label, value, icon, tone, testID }: {
  label: string; value: string; icon: string; tone: "success" | "warning" | "error" | "info"; testID?: string;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const toneColor = { success: colors.success, warning: colors.warning, error: colors.error, info: colors.info }[tone];
  return (
    <Card style={s.metricCard} testID={testID}>
      <View style={[s.metricIcon, { backgroundColor: toneColor + "22" }]}>
        <Ionicons name={icon as any} size={18} color={toneColor} />
      </View>
      <Text style={s.metricLabel}>{label}</Text>
      <Text style={s.metricValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </Card>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.surface },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  greeting: { fontSize: 22, fontWeight: "900", color: c.onSurface },
  brandLine: { fontSize: 13, color: c.brandSecondary, fontWeight: "700", marginTop: 2 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.brandTertiary, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 18, fontWeight: "800", color: c.onBrandTertiary },
  demoBanner: { gap: 8, backgroundColor: c.brandTertiary, padding: spacing.md, borderRadius: radius.md },
  demoText: { fontSize: 13, fontWeight: "700", color: c.onBrandTertiary },
  primaryLabel: { fontSize: 14, color: "#FFF4E0", fontWeight: "600" },
  primaryValue: { fontSize: 34, fontWeight: "900", color: "#FFFFFF", marginTop: 4 },
  primarySub: { fontSize: 12, color: "#FFE9CC" },
  primarySubVal: { fontSize: 15, fontWeight: "800", color: "#FFFFFF", marginTop: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  metricCard: { width: "47.5%", flexGrow: 1, gap: 6 },
  metricIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  metricLabel: { fontSize: 13, color: c.muted, fontWeight: "600" },
  metricValue: { fontSize: 19, fontWeight: "800", color: c.onSurface },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: c.onSurface, marginTop: spacing.sm },
  actionsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  actionCard: { width: "47.5%", flexGrow: 1, alignItems: "center", gap: 8, paddingVertical: spacing.lg },
  actionIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  actionLabel: { fontSize: 14, fontWeight: "700", color: c.onSurface },
  cardTitle: { fontSize: 16, fontWeight: "800", color: c.onSurface },
  legend: { fontSize: 12, color: c.muted },
  dot: { width: 10, height: 10, borderRadius: 5 },
  lowRow: { gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.divider },
  lowName: { flex: 1, fontSize: 14, fontWeight: "600", color: c.onSurface },
  lowVal: { fontSize: 13, color: c.error, fontWeight: "700" },
  bestRow: { gap: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: c.divider },
  rank: { width: 26, height: 26, borderRadius: 13, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  rankText: { fontSize: 13, fontWeight: "800", color: c.onSurfaceTertiary },
  bestName: { flex: 1, fontSize: 14, fontWeight: "600", color: c.onSurface },
  bestQty: { fontSize: 13, fontWeight: "700", color: c.onSurface },
  bestRev: { fontSize: 12, color: c.muted },
  emptyLine: { fontSize: 14, color: c.muted, paddingVertical: 8 },
}));
