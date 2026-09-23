// QRIS checkout modal: QR code, countdown, status polling, simulator controls.
import Ionicons from "@react-native-vector-icons/ionicons";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, ScrollView, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch } from "@/src/api";
import { useFeedback } from "@/src/components/feedback";
import { PrintButton, Receipt } from "@/src/components/Receipt";
import { Badge, Button, Row } from "@/src/components/ui";
import { rupiah } from "@/src/format";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

export function QrisModal({ visible, paymentId, initialQr, orderNo, amount, business, onClose, onDone }: {
  visible: boolean; paymentId: string; initialQr: string; orderNo: string; amount: number;
  business?: any; onClose: () => void; onDone: () => void;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { toast, confirm } = useFeedback();
  const qc = useQueryClient();
  const [status, setStatus] = useState("PAYMENT_PENDING");
  const [sale, setSale] = useState<any>(null);
  const [simulator, setSimulator] = useState(false);
  const [remaining, setRemaining] = useState(30 * 60);
  const [checking, setChecking] = useState(false);
  const pollRef = useRef<any>(null);

  useEffect(() => {
    if (!visible) return;
    setStatus("PAYMENT_PENDING");
    setRemaining(30 * 60);
    poll(false);
    pollRef.current = setInterval(() => poll(false), 4000);
    const timer = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => {
      clearInterval(pollRef.current);
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const poll = async (refresh: boolean) => {
    try {
      const res = await apiFetch(`/payments/${paymentId}${refresh ? "?refresh=1" : ""}`);
      setSimulator(res.simulator);
      setStatus(res.payment.status);
      setSale(res.sale);
      if (["PAID", "EXPIRED", "FAILED", "CANCELLED"].includes(res.payment.status)) {
        clearInterval(pollRef.current);
        if (res.payment.status === "PAID") {
          qc.invalidateQueries();
        }
      }
    } catch {
      /* keep polling */
    }
  };

  const checkNow = async () => {
    setChecking(true);
    await poll(true);
    setChecking(false);
    toast("Status pembayaran diperbarui", "info");
  };

  const simulate = async (event: string) => {
    try {
      await apiFetch(`/payments/${paymentId}/simulate?event=${event}`, { method: "POST", body: {} });
      await poll(false);
    } catch (e: any) {
      toast(e.message, "error");
    }
  };

  const cancel = () => {
    confirm({
      title: "Batalkan pembayaran?",
      message: "Pesanan ini akan dibatalkan dan stok tidak akan dikurangi.",
      danger: true,
      confirmLabel: "Batalkan",
      onConfirm: async () => {
        try {
          if (sale?.id) await apiFetch(`/sales/${sale.id}/cancel-payment`, { method: "POST", body: {} });
          qc.invalidateQueries();
          onClose();
        } catch (e: any) {
          toast(e.message, "error");
        }
      },
    });
  };

  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");
  const isPaid = status === "PAID";
  const isFailed = ["EXPIRED", "FAILED", "CANCELLED"].includes(status);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={[s.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.xl }}>
            {isPaid ? (
              <View style={{ alignItems: "center", gap: spacing.md }}>
                <View style={[s.statusCircle, { backgroundColor: colors.success }]}>
                  <Ionicons name="checkmark" size={48} color="#FFFFFF" />
                </View>
                <Text style={s.paidTitle}>Pembayaran Berhasil</Text>
                <Text style={s.paidSub}>{orderNo} · {rupiah(amount)} · QRIS</Text>
                {sale ? (
                  <View style={{ width: "100%", marginTop: spacing.sm }}>
                    <Receipt sale={sale} business={business} />
                  </View>
                ) : null}
                <View style={{ width: "100%", gap: spacing.sm, marginTop: spacing.md }}>
                  {sale ? <PrintButton sale={sale} business={business} /> : null}
                  <Button label="Transaksi Baru" icon="add" onPress={onDone} testID="qris-new-transaction" />
                </View>
              </View>
            ) : isFailed ? (
              <View style={{ alignItems: "center", gap: spacing.md }}>
                <View style={[s.statusCircle, { backgroundColor: colors.error }]}>
                  <Ionicons name="close" size={48} color="#FFFFFF" />
                </View>
                <Text style={s.paidTitle}>Pembayaran {status === "EXPIRED" ? "Kedaluwarsa" : "Gagal"}</Text>
                <Text style={s.paidSub}>Silakan coba lagi dengan QRIS baru</Text>
                <View style={{ width: "100%", gap: spacing.sm, marginTop: spacing.md }}>
                  <Button label="Buat QRIS Baru" icon="refresh" onPress={async () => {
                    try {
                      const p = await apiFetch(`/sales/${sale?.id}/retry-payment`, { method: "POST", body: {} });
                      toast("QRIS baru dibuat", "info");
                      setStatus("PAYMENT_PENDING");
                      setRemaining(30 * 60);
                      pollRef.current = setInterval(() => poll(false), 4000);
                    } catch (e: any) { toast(e.message, "error"); }
                  }} />
                  <Button label="Tutup" variant="secondary" onPress={onClose} />
                </View>
              </View>
            ) : (
              <>
                <Row style={{ justifyContent: "space-between", marginBottom: spacing.md }}>
                  <View>
                    <Text style={s.brand}>BRADERS · QRIS</Text>
                    <Text style={s.orderNo}>{orderNo}</Text>
                  </View>
                  <Badge label={`${mm}:${ss}`} tone="warning" />
                </Row>
                <Text style={s.amount}>{rupiah(amount)}</Text>
                <View style={s.qrBox}>
                  {initialQr ? (
                    <QRCode value={initialQr} size={220} color={colors.onSurface} backgroundColor="#FFFFFF" />
                  ) : (
                    <ActivityIndicator color={colors.brandPrimary} />
                  )}
                </View>
                <Row style={{ justifyContent: "center", gap: 8, marginBottom: spacing.md }}>
                  <ActivityIndicator size="small" color={colors.brandPrimary} />
                  <Text style={s.waiting}>Menunggu pembayaran…</Text>
                </Row>
                <Text style={s.hint}>Scan QR dengan aplikasi bank / e-wallet apa pun yang mendukung QRIS</Text>

                {simulator ? (
                  <View style={s.simBox}>
                    <Text style={s.simTitle}>🧪 Mode Simulator (uji coba)</Text>
                    <View style={s.simRow}>
                      <View style={{ flex: 1 }}><Button small label="Bayar" variant="primary" onPress={() => simulate("paid")} testID="sim-paid" /></View>
                      <View style={{ flex: 1 }}><Button small label="Kedaluwarsa" variant="secondary" onPress={() => simulate("expire")} testID="sim-expire" /></View>
                      <View style={{ flex: 1 }}><Button small label="Gagal" variant="secondary" onPress={() => simulate("fail")} testID="sim-fail" /></View>
                    </View>
                  </View>
                ) : null}

                <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
                  <Button label="Cek Status Pembayaran" icon="refresh" variant="outline" loading={checking} onPress={checkNow} testID="qris-check-status" />
                  <Button label="Batalkan Pembayaran" icon="close" variant="ghost" onPress={cancel} testID="qris-cancel" />
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  backdrop: { flex: 1, backgroundColor: "rgba(44,24,16,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "94%" },
  brand: { fontSize: 13, fontWeight: "800", color: c.brandSecondary },
  orderNo: { fontSize: 16, fontWeight: "800", color: c.onSurface },
  amount: { fontSize: 32, fontWeight: "900", color: c.onSurface, textAlign: "center", marginBottom: spacing.md },
  qrBox: { alignSelf: "center", padding: spacing.lg, backgroundColor: "#FFFFFF", borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, marginBottom: spacing.md },
  waiting: { fontSize: 14, color: c.muted, fontWeight: "600" },
  hint: { fontSize: 13, color: c.muted, textAlign: "center", maxWidth: 300, alignSelf: "center" },
  simBox: { marginTop: spacing.lg, padding: spacing.md, backgroundColor: c.brandTertiary, borderRadius: radius.md, gap: spacing.sm },
  simTitle: { fontSize: 13, fontWeight: "800", color: c.onBrandTertiary },
  simRow: { flexDirection: "row", gap: spacing.sm },
  statusCircle: { width: 88, height: 88, borderRadius: 44, alignItems: "center", justifyContent: "center", marginTop: spacing.md },
  paidTitle: { fontSize: 22, fontWeight: "900", color: c.onSurface },
  paidSub: { fontSize: 14, color: c.muted, textAlign: "center" },
}));
