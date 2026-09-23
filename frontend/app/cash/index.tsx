import Ionicons from "@react-native-vector-icons/ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch } from "@/src/api";
import { useFeedback } from "@/src/components/feedback";
import { Header } from "@/src/components/Header";
import { Badge, Button, Card, Field, Input, Loading, Row } from "@/src/components/ui";
import { fmtDateTime, rupiah } from "@/src/format";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

export default function Cash() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { toast } = useFeedback();
  const qc = useQueryClient();
  const [openCash, setOpenCash] = useState("");
  const [actualCash, setActualCash] = useState("");
  const [txType, setTxType] = useState<"addition" | "withdrawal">("addition");
  const [txAmount, setTxAmount] = useState("");
  const [txNote, setTxNote] = useState("");
  const [txModal, setTxModal] = useState(false);
  const [closeModal, setCloseModal] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data, isLoading, refetch } = useQuery({ queryKey: ["cash-status"], queryFn: () => apiFetch("/cash/status") });
  const { data: txs } = useQuery({ queryKey: ["cash-tx", data?.session?.id], queryFn: () => apiFetch(`/cash/transactions${data?.session?.id ? `?session_id=${data.session.id}` : ""}`), enabled: !!data });

  const session = data?.session;

  const openShift = async () => {
    setBusy(true);
    try { await apiFetch("/cash/sessions/open", { method: "POST", body: { opening_cash: parseFloat(openCash) || 0 } }); qc.invalidateQueries(); setOpenCash(""); toast("Shift dibuka", "success"); }
    catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  };
  const closeShift = async () => {
    setBusy(true);
    try {
      const r = await apiFetch(`/cash/sessions/${session.id}/close`, { method: "POST", body: { actual_cash: parseFloat(actualCash) || 0 } });
      qc.invalidateQueries(); setCloseModal(false); setActualCash("");
      toast(`Shift ditutup. Selisih ${rupiah(r.difference)}`, r.difference === 0 ? "success" : "info");
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  };
  const addTx = async () => {
    if (!parseFloat(txAmount)) { toast("Jumlah wajib diisi", "error"); return; }
    setBusy(true);
    try { await apiFetch("/cash/transactions", { method: "POST", body: { type: txType, amount: parseFloat(txAmount), note: txNote } }); qc.invalidateQueries(); setTxModal(false); setTxAmount(""); setTxNote(""); toast("Tercatat", "success"); }
    catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  if (isLoading) return <View style={s.container}><Header title="Kas / Shift" back /><Loading /></View>;

  return (
    <View style={s.container}>
      <Header title="Kas / Shift" back subtitle="Manajemen kas kasir" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 24, gap: spacing.md }}>
        <Card style={{ backgroundColor: colors.brandPrimary }}>
          <Text style={s.balLabel}>Saldo Kas Saat Ini</Text>
          <Text style={s.balVal}>{rupiah(data?.balance)}</Text>
        </Card>

        {session ? (
          <>
            <Card>
              <Row style={{ justifyContent: "space-between", marginBottom: spacing.sm }}>
                <Text style={s.cardTitle}>Shift Aktif</Text>
                <Badge label="Terbuka" tone="success" />
              </Row>
              <Line l="Dibuka oleh" r={session.opened_by_name} />
              <Line l="Waktu buka" r={fmtDateTime(session.opened_at)} />
              <Line l="Kas awal" r={rupiah(session.opening_cash)} />
              <Line l="Pergerakan" r={rupiah(session.moved_total)} />
              <View style={s.divider} />
              <Line l="Kas seharusnya" r={rupiah(session.expected_cash)} bold />
            </Card>
            <Row style={{ gap: spacing.md }}>
              <View style={{ flex: 1 }}><Button label="Setor/Tarik" icon="swap-vertical" variant="secondary" onPress={() => setTxModal(true)} testID="cash-tx" /></View>
              <View style={{ flex: 1 }}><Button label="Tutup Shift" icon="lock-closed" onPress={() => setCloseModal(true)} testID="cash-close" /></View>
            </Row>
          </>
        ) : (
          <Card>
            <Text style={s.cardTitle}>Buka Shift Baru</Text>
            <Text style={s.hint}>Masukkan kas awal di laci untuk memulai shift.</Text>
            <View style={{ height: spacing.md }} />
            <Field label="Kas Awal (Rp)"><Input value={openCash} onChangeText={setOpenCash} keyboardType="numeric" placeholder="0" testID="cash-open-input" /></Field>
            <Button label="Buka Shift" icon="lock-open" loading={busy} onPress={openShift} testID="cash-open" />
          </Card>
        )}

        <Text style={s.sectionTitle}>Aktivitas Kas Terbaru</Text>
        {(txs || []).slice(0, 20).map((t: any) => (
          <Row key={t.id} style={s.txRow}>
            <View style={{ flex: 1 }}><Text style={s.txNote}>{t.note}</Text><Text style={s.txTime}>{fmtDateTime(t.created_at)}</Text></View>
            <Text style={[s.txAmt, { color: t.amount >= 0 ? colors.success : colors.error }]}>{t.amount >= 0 ? "+" : ""}{rupiah(t.amount)}</Text>
          </Row>
        ))}
      </ScrollView>

      <Modal visible={txModal} transparent animationType="slide" onRequestClose={() => setTxModal(false)}>
        <View style={s.backdrop}><View style={[s.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <Row style={s.sheetHead}><Text style={s.sheetTitle}>Setor / Tarik Kas</Text><Pressable onPress={() => setTxModal(false)} hitSlop={8}><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable></Row>
          <KeyboardAwareScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled" bottomOffset={20}>
            <Row style={{ gap: spacing.sm, marginBottom: spacing.md }}>
              <Pressable onPress={() => setTxType("addition")} style={[s.txTypeChip, txType === "addition" && { backgroundColor: colors.brandPrimary }]}><Text style={[s.txTypeText, txType === "addition" && { color: colors.onBrandPrimary }]}>Setor Kas</Text></Pressable>
              <Pressable onPress={() => setTxType("withdrawal")} style={[s.txTypeChip, txType === "withdrawal" && { backgroundColor: colors.brandPrimary }]}><Text style={[s.txTypeText, txType === "withdrawal" && { color: colors.onBrandPrimary }]}>Tarik Kas</Text></Pressable>
            </Row>
            <Field label="Jumlah (Rp)"><Input value={txAmount} onChangeText={setTxAmount} keyboardType="numeric" testID="cash-tx-amount" /></Field>
            <Field label="Catatan"><Input value={txNote} onChangeText={setTxNote} placeholder="mis. ambil untuk belanja" /></Field>
            <Button label="Simpan" icon="checkmark" loading={busy} onPress={addTx} testID="cash-tx-save" />
          </KeyboardAwareScrollView>
        </View></View>
      </Modal>

      <Modal visible={closeModal} transparent animationType="slide" onRequestClose={() => setCloseModal(false)}>
        <View style={s.backdrop}><View style={[s.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <Row style={s.sheetHead}><Text style={s.sheetTitle}>Tutup Shift</Text><Pressable onPress={() => setCloseModal(false)} hitSlop={8}><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable></Row>
          <KeyboardAwareScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled" bottomOffset={20}>
            <Line l="Kas seharusnya" r={rupiah(session?.expected_cash)} bold />
            <View style={{ height: spacing.md }} />
            <Field label="Kas Aktual di Laci (Rp)" hint="Hitung uang fisik lalu masukkan di sini"><Input value={actualCash} onChangeText={setActualCash} keyboardType="numeric" testID="cash-actual" /></Field>
            {actualCash ? <Line l="Selisih" r={rupiah((parseFloat(actualCash) || 0) - (session?.expected_cash || 0))} bold /> : null}
            <View style={{ height: spacing.md }} />
            <Button label="Tutup Shift" icon="lock-closed" loading={busy} onPress={closeShift} testID="cash-close-confirm" />
          </KeyboardAwareScrollView>
        </View></View>
      </Modal>
    </View>
  );
}

function Line({ l, r, bold }: { l: string; r: string; bold?: boolean }) {
  const s = useStyles();
  return <Row style={s.line}><Text style={[s.lineL, bold && s.bold]}>{l}</Text><Text style={[s.lineR, bold && s.bold]}>{r}</Text></Row>;
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.surface },
  balLabel: { fontSize: 14, color: "#FFE9CC", fontWeight: "600" },
  balVal: { fontSize: 32, fontWeight: "900", color: "#FFFFFF", marginTop: 4 },
  cardTitle: { fontSize: 17, fontWeight: "800", color: c.onSurface },
  hint: { fontSize: 13, color: c.muted, marginTop: 4 },
  line: { justifyContent: "space-between", paddingVertical: 4 },
  lineL: { fontSize: 14, color: c.muted },
  lineR: { fontSize: 14, fontWeight: "700", color: c.onSurface },
  bold: { fontSize: 16, fontWeight: "900", color: c.onSurface },
  divider: { borderTopWidth: 1, borderTopColor: c.divider, marginVertical: 6 },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: c.onSurface, marginTop: spacing.sm },
  txRow: { justifyContent: "space-between", backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: spacing.md },
  txNote: { fontSize: 14, fontWeight: "600", color: c.onSurface },
  txTime: { fontSize: 12, color: c.muted },
  txAmt: { fontSize: 15, fontWeight: "800" },
  backdrop: { flex: 1, backgroundColor: "rgba(44,24,16,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "94%" },
  sheetHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.divider },
  sheetTitle: { fontSize: 19, fontWeight: "900", color: c.onSurface },
  txTypeChip: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: radius.md, backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.border },
  txTypeText: { fontSize: 14, fontWeight: "700", color: c.onSurfaceTertiary },
}));
