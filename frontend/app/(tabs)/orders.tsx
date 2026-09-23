import Ionicons from "@react-native-vector-icons/ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FlatList, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch, buildQuery } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useFeedback } from "@/src/components/feedback";
import { PrintButton, Receipt } from "@/src/components/Receipt";
import { Badge, Button, EmptyState, ErrorState, Field, Input, Loading, Row } from "@/src/components/ui";
import { fmtDateTime, PAYMENT_LABELS, rupiah, STATUS_LABELS } from "@/src/format";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

const FILTERS = [
  { key: "", label: "Semua" },
  { key: "completed", label: "Selesai" },
  { key: "pending", label: "Menunggu" },
  { key: "void", label: "Dibatalkan" },
];

export default function Orders() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [filter, setFilter] = useState("");
  const [detail, setDetail] = useState<any>(null);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["orders", filter],
    queryFn: () => apiFetch(`/sales${buildQuery({ status: filter, limit: 100 })}`),
  });

  const statusTone = (st: string) =>
    st === "completed" ? "success" : st === "pending_payment" ? "warning" : "error";

  return (
    <View style={s.container}>
      <View style={[s.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Pesanan</Text>
      </View>
      <View style={s.chipWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
          {FILTERS.map((f) => {
            const active = f.key === filter;
            return (
              <Pressable key={f.key} onPress={() => setFilter(f.key)} testID={`order-filter-${f.key || "all"}`}
                style={[s.chip, active && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }]}>
                <Text style={[s.chipText, active && { color: colors.onBrandPrimary }]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {isLoading ? <Loading /> : isError ? <ErrorState onRetry={refetch} /> : (
        <FlatList
          data={data || []}
          keyExtractor={(o: any) => o.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 24, gap: spacing.md }}
          onRefresh={refetch}
          refreshing={isRefetching}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<EmptyState icon="receipt-outline" title="Belum ada pesanan" subtitle="Transaksi dari kasir akan muncul di sini" />}
          renderItem={({ item }) => (
            <Pressable style={s.orderCard} onPress={() => setDetail(item)} testID={`order-${item.id}`}>
              <Row style={{ justifyContent: "space-between" }}>
                <Text style={s.orderNo}>{item.order_no}</Text>
                <Badge label={STATUS_LABELS[item.status] || item.status} tone={statusTone(item.status) as any} />
              </Row>
              <Text style={s.orderMeta}>{fmtDateTime(item.paid_at || item.created_at)} · {item.cashier?.name}</Text>
              <Row style={{ justifyContent: "space-between", marginTop: 6 }}>
                <Row style={{ gap: 6 }}>
                  <Ionicons name="pricetag-outline" size={14} color={colors.muted} />
                  <Text style={s.orderItems}>{item.items.length} item · {PAYMENT_LABELS[item.payment_method]}</Text>
                </Row>
                <Text style={s.orderTotal}>{rupiah(item.total)}</Text>
              </Row>
            </Pressable>
          )}
        />
      )}

      <OrderDetail order={detail} onClose={() => setDetail(null)} canVoid={user?.role === "owner"} />
    </View>
  );
}

function OrderDetail({ order, onClose, canVoid }: { order: any; onClose: () => void; canVoid: boolean }) {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { toast, confirm } = useFeedback();
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  const { data: settings } = useQuery({ queryKey: ["settings-order"], queryFn: () => apiFetch("/settings"), enabled: !!order });

  if (!order) return null;
  const isVoided = ["void", "cancelled"].includes(order.status);
  const isCompleted = order.status === "completed";

  const doVoid = () => {
    if (reason.trim().length < 3) { toast("Alasan pembatalan minimal 3 karakter", "error"); return; }
    confirm({
      title: "Batalkan transaksi?",
      message: "Stok akan dikembalikan dan pencatatan keuangan dibalik. Riwayat tetap tersimpan.",
      danger: true, confirmLabel: "Batalkan",
      onConfirm: async () => {
        setVoiding(true);
        try {
          await apiFetch(`/sales/${order.id}/void`, { method: "POST", body: { reason: reason.trim() } });
          qc.invalidateQueries();
          toast("Transaksi dibatalkan", "success");
          onClose();
        } catch (e: any) { toast(e.message, "error"); }
        finally { setVoiding(false); }
      },
    });
  };

  return (
    <Modal visible={!!order} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={[s.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <Row style={s.sheetHead}>
            <Text style={s.sheetTitle}>Detail Pesanan</Text>
            <Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable>
          </Row>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }} showsVerticalScrollIndicator={false}>
            <Receipt sale={order} business={settings} />
            {order.gateway_fee > 0 ? (
              <View style={s.feeBox}>
                <Row style={{ justifyContent: "space-between" }}><Text style={s.feeL}>Biaya QRIS</Text><Text style={s.feeR}>-{rupiah(order.gateway_fee)}</Text></Row>
                <Row style={{ justifyContent: "space-between" }}><Text style={s.feeL}>Diterima Bersih</Text><Text style={[s.feeR, { color: colors.success }]}>{rupiah(order.net_received)}</Text></Row>
              </View>
            ) : null}
            {isVoided ? (
              <View style={s.voidBox}>
                <Text style={s.voidTitle}>Dibatalkan</Text>
                <Text style={s.voidReason}>{order.voided?.reason} — oleh {order.voided?.by_name}</Text>
              </View>
            ) : null}
            {isCompleted ? <PrintButton sale={order} business={settings} /> : null}
            {isCompleted && canVoid ? (
              <View style={{ gap: spacing.sm }}>
                <Field label="Alasan pembatalan">
                  <Input placeholder="mis. salah input, pesanan dibatalkan" value={reason} onChangeText={setReason} testID="void-reason" />
                </Field>
                <Button label="Batalkan Transaksi" icon="close-circle" variant="danger" loading={voiding} onPress={doVoid} testID="void-submit" />
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.surface },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  title: { fontSize: 24, fontWeight: "900", color: c.onSurface },
  chipWrap: { height: 56, borderBottomWidth: 1, borderBottomColor: c.divider },
  chipRow: { gap: spacing.sm, paddingHorizontal: spacing.lg, alignItems: "center" },
  chip: { height: 36, flexShrink: 0, paddingHorizontal: 16, borderRadius: radius.pill, justifyContent: "center", backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.border },
  chipText: { fontSize: 14, fontWeight: "700", color: c.onSurfaceTertiary },
  orderCard: { backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: spacing.lg, gap: 4 },
  orderNo: { fontSize: 16, fontWeight: "800", color: c.onSurface },
  orderMeta: { fontSize: 13, color: c.muted },
  orderItems: { fontSize: 13, color: c.muted },
  orderTotal: { fontSize: 17, fontWeight: "900", color: c.brandSecondary },
  backdrop: { flex: 1, backgroundColor: "rgba(44,24,16,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "94%" },
  sheetHead: { justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.divider },
  sheetTitle: { fontSize: 19, fontWeight: "900", color: c.onSurface },
  feeBox: { backgroundColor: c.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  feeL: { fontSize: 14, color: c.muted },
  feeR: { fontSize: 14, fontWeight: "700", color: c.onSurface },
  voidBox: { backgroundColor: "#FEE2E2", borderRadius: radius.md, padding: spacing.md },
  voidTitle: { fontSize: 15, fontWeight: "800", color: c.error },
  voidReason: { fontSize: 13, color: c.onSurfaceSecondary, marginTop: 2 },
}));
