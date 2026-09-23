import Ionicons from "@react-native-vector-icons/ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FlatList, Modal, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch } from "@/src/api";
import { useFeedback } from "@/src/components/feedback";
import { Header } from "@/src/components/Header";
import { Badge, Button, EmptyState, Field, Input, Loading, Row } from "@/src/components/ui";
import { fmtDate, rupiah, todayISO } from "@/src/format";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

export default function Marketing() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { toast } = useFeedback();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const { data, isLoading, refetch } = useQuery({ queryKey: ["promotions"], queryFn: () => apiFetch("/promotions") });

  const toggle = async (id: string) => {
    try { await apiFetch(`/promotions/${id}/toggle`, { method: "POST", body: {} }); refetch(); }
    catch (e: any) { toast(e.message, "error"); }
  };

  return (
    <View style={s.container}>
      <Header title="Marketing & Promo" back subtitle="Voucher & diskon" />
      {isLoading ? <Loading /> : (
        <FlatList
          data={data || []}
          keyExtractor={(p: any) => p.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 96, gap: spacing.md }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<EmptyState icon="megaphone-outline" title="Belum ada promo" action={<Button label="Buat Promo" icon="add" onPress={() => setShowForm(true)} full={false} />} />}
          renderItem={({ item }) => (
            <View style={s.card}>
              <Row style={{ justifyContent: "space-between" }}>
                <View style={s.codeBox}><Text style={s.code}>{item.code}</Text></View>
                <Switch value={item.active} onValueChange={() => toggle(item.id)} trackColor={{ true: colors.brandPrimary }} testID={`promo-toggle-${item.id}`} />
              </Row>
              <Text style={s.discount}>{item.discount_type === "percent" ? `Diskon ${item.value}%` : `Potongan ${rupiah(item.value)}`}{item.max_discount ? ` (maks ${rupiah(item.max_discount)})` : ""}</Text>
              <Text style={s.meta}>Min. belanja {rupiah(item.min_purchase)} · {fmtDate(item.start_date)} – {fmtDate(item.end_date)}</Text>
              <Row style={s.perfRow}>
                <View style={s.perf}><Text style={s.perfV}>{item.uses}</Text><Text style={s.perfL}>Dipakai</Text></View>
                <View style={s.perf}><Text style={s.perfV}>{rupiah(item.revenue)}</Text><Text style={s.perfL}>Omzet</Text></View>
                <View style={s.perf}><Text style={s.perfV}>{rupiah(item.discount_cost)}</Text><Text style={s.perfL}>Biaya Diskon</Text></View>
              </Row>
            </View>
          )}
        />
      )}
      <Pressable style={[s.fab, { bottom: insets.bottom + 16 }]} onPress={() => setShowForm(true)} testID="promo-add"><Ionicons name="add" size={28} color={colors.onBrandPrimary} /></Pressable>
      {showForm ? <PromoForm onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); refetch(); }} /> : null}
    </View>
  );
}

function PromoForm({ onClose, onSaved }: any) {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { toast } = useFeedback();
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [type, setType] = useState<"percent" | "fixed">("percent");
  const [value, setValue] = useState("");
  const [minP, setMinP] = useState("0");
  const [maxD, setMaxD] = useState("");
  const [start, setStart] = useState(todayISO());
  const [end, setEnd] = useState(todayISO());
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!code.trim()) { toast("Kode promo wajib diisi", "error"); return; }
    if (!parseFloat(value)) { toast("Nilai diskon wajib diisi", "error"); return; }
    setSaving(true);
    try {
      await apiFetch("/promotions", { method: "POST", body: {
        code: code.trim(), discount_type: type, value: parseFloat(value), min_purchase: parseFloat(minP) || 0,
        max_discount: maxD ? parseFloat(maxD) : null, start_date: start, end_date: end, active: true,
      } });
      qc.invalidateQueries(); toast("Promo dibuat", "success"); onSaved();
    } catch (e: any) { toast(e.message, "error"); } finally { setSaving(false); }
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}><View style={[s.sheet, { paddingBottom: insets.bottom }]}>
        <Row style={s.sheetHead}><Text style={s.sheetTitle}>Promo Baru</Text><Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable></Row>
        <KeyboardAwareScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled" bottomOffset={20}>
          <Field label="Kode Promo"><Input value={code} onChangeText={(v) => setCode(v.toUpperCase())} autoCapitalize="characters" placeholder="LEZATOSS10" testID="prf-code" /></Field>
          <Field label="Jenis Diskon">
            <Row style={{ gap: spacing.sm }}>
              <Pressable onPress={() => setType("percent")} style={[s.typeChip, type === "percent" && { backgroundColor: colors.brandPrimary }]}><Text style={[s.typeText, type === "percent" && { color: colors.onBrandPrimary }]}>Persen (%)</Text></Pressable>
              <Pressable onPress={() => setType("fixed")} style={[s.typeChip, type === "fixed" && { backgroundColor: colors.brandPrimary }]}><Text style={[s.typeText, type === "fixed" && { color: colors.onBrandPrimary }]}>Nominal (Rp)</Text></Pressable>
            </Row>
          </Field>
          <Field label={type === "percent" ? "Nilai (%)" : "Nilai (Rp)"}><Input value={value} onChangeText={setValue} keyboardType="numeric" testID="prf-value" /></Field>
          <Row style={{ gap: spacing.md }}>
            <View style={{ flex: 1 }}><Field label="Min. Belanja"><Input value={minP} onChangeText={setMinP} keyboardType="numeric" /></Field></View>
            <View style={{ flex: 1 }}><Field label="Maks. Diskon"><Input value={maxD} onChangeText={setMaxD} keyboardType="numeric" placeholder="opsional" /></Field></View>
          </Row>
          <Row style={{ gap: spacing.md }}>
            <View style={{ flex: 1 }}><Field label="Mulai"><Input value={start} onChangeText={setStart} placeholder="YYYY-MM-DD" /></Field></View>
            <View style={{ flex: 1 }}><Field label="Berakhir"><Input value={end} onChangeText={setEnd} placeholder="YYYY-MM-DD" /></Field></View>
          </Row>
          <Button label="Simpan Promo" icon="checkmark" loading={saving} onPress={save} testID="prf-save" />
        </KeyboardAwareScrollView>
      </View></View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.surface },
  card: { backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: spacing.lg, gap: 4 },
  codeBox: { backgroundColor: c.brandTertiary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1, borderColor: c.brandPrimary, borderStyle: "dashed" },
  code: { fontSize: 16, fontWeight: "900", color: c.onBrandTertiary, letterSpacing: 1 },
  discount: { fontSize: 16, fontWeight: "800", color: c.onSurface, marginTop: 4 },
  meta: { fontSize: 13, color: c.muted },
  perfRow: { gap: spacing.sm, marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: c.divider },
  perf: { flex: 1 },
  perfV: { fontSize: 14, fontWeight: "800", color: c.onSurface },
  perfL: { fontSize: 11, color: c.muted },
  fab: { position: "absolute", right: spacing.lg, width: 56, height: 56, borderRadius: 28, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center", elevation: 6 },
  backdrop: { flex: 1, backgroundColor: "rgba(44,24,16,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "94%" },
  sheetHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.divider },
  sheetTitle: { fontSize: 19, fontWeight: "900", color: c.onSurface },
  typeChip: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: radius.md, backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.border },
  typeText: { fontSize: 14, fontWeight: "700", color: c.onSurfaceTertiary },
}));
