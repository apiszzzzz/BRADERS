import Ionicons from "@react-native-vector-icons/ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FlatList, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch } from "@/src/api";
import { useFeedback } from "@/src/components/feedback";
import { Header } from "@/src/components/Header";
import { Badge, Button, EmptyState, Field, Input, Loading, Row } from "@/src/components/ui";
import { fmtDate, rupiah, todayISO } from "@/src/format";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

export default function Purchases() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [showForm, setShowForm] = useState(false);
  const { data, isLoading, refetch } = useQuery({ queryKey: ["purchases"], queryFn: () => apiFetch("/purchases") });

  return (
    <View style={s.container}>
      <Header title="Pembelian" back subtitle="Stok masuk dari supplier" />
      {isLoading ? <Loading /> : (
        <FlatList
          data={data || []}
          keyExtractor={(p: any) => p.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 96, gap: spacing.md }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<EmptyState icon="download-outline" title="Belum ada pembelian" action={<Button label="Catat Pembelian" icon="add" onPress={() => setShowForm(true)} full={false} />} />}
          renderItem={({ item }) => (
            <View style={s.card}>
              <Row style={{ justifyContent: "space-between" }}>
                <Text style={s.no}>{item.purchase_no}</Text>
                <Badge label={item.payment_status === "paid" ? "Lunas" : "Belum Bayar"} tone={item.payment_status === "paid" ? "success" : "warning"} />
              </Row>
              <Text style={s.sup}>{item.supplier_name} · {fmtDate(item.date)}</Text>
              <Text style={s.items}>{item.items.length} bahan</Text>
              <Text style={s.total}>{rupiah(item.total)}</Text>
            </View>
          )}
        />
      )}
      <Pressable style={[s.fab, { bottom: insets.bottom + 16 }]} onPress={() => setShowForm(true)} testID="purchase-add"><Ionicons name="add" size={28} color={colors.onBrandPrimary} /></Pressable>
      {showForm ? <PurchaseForm onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); refetch(); }} /> : null}
    </View>
  );
}

function PurchaseForm({ onClose, onSaved }: any) {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { toast } = useFeedback();
  const qc = useQueryClient();
  const { data: ings } = useQuery({ queryKey: ["ingredients-list"], queryFn: () => apiFetch("/ingredients") });
  const [supplier, setSupplier] = useState("");
  const [date, setDate] = useState(todayISO());
  const [paid, setPaid] = useState(true);
  const [items, setItems] = useState<{ ingredient_id: string; qty: string; unit_price: string }[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const ingMap: Record<string, any> = {};
  (ings?.items || []).forEach((i: any) => (ingMap[i.id] = i));
  const total = items.reduce((sum, it) => sum + (parseFloat(it.qty) || 0) * (parseFloat(it.unit_price) || 0), 0);

  const save = async () => {
    if (!supplier.trim()) { toast("Supplier wajib diisi", "error"); return; }
    const valid = items.filter((i) => i.ingredient_id && parseFloat(i.qty) > 0);
    if (!valid.length) { toast("Tambahkan minimal 1 bahan", "error"); return; }
    setSaving(true);
    try {
      await apiFetch("/purchases", { method: "POST", body: {
        supplier_name: supplier.trim(), date, payment_status: paid ? "paid" : "unpaid", payment_method: "cash",
        items: valid.map((i) => ({ ingredient_id: i.ingredient_id, qty: parseFloat(i.qty), unit_price: parseFloat(i.unit_price) || 0 })),
      } });
      qc.invalidateQueries();
      toast("Pembelian dicatat, stok bertambah", "success"); onSaved();
    } catch (e: any) { toast(e.message, "error"); } finally { setSaving(false); }
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={[s.sheet, { paddingBottom: insets.bottom }]}>
          <Row style={s.sheetHead}><Text style={s.sheetTitle}>Pembelian Baru</Text><Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable></Row>
          <KeyboardAwareScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled" bottomOffset={20}>
            <Field label="Supplier"><Input value={supplier} onChangeText={setSupplier} placeholder="Nama supplier" testID="pu-supplier" /></Field>
            <Field label="Tanggal"><Input value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" testID="pu-date" /></Field>
            <Row style={s.paidRow}>
              <Pressable onPress={() => setPaid(true)} style={[s.paidChip, paid && { backgroundColor: colors.brandPrimary }]}><Text style={[s.paidText, paid && { color: colors.onBrandPrimary }]}>Lunas (Tunai)</Text></Pressable>
              <Pressable onPress={() => setPaid(false)} style={[s.paidChip, !paid && { backgroundColor: colors.brandPrimary }]}><Text style={[s.paidText, !paid && { color: colors.onBrandPrimary }]}>Belum Bayar</Text></Pressable>
            </Row>

            <Row style={{ justifyContent: "space-between", marginTop: spacing.sm, marginBottom: spacing.sm }}>
              <Text style={s.blockLabel}>Bahan Dibeli</Text>
              <Pressable onPress={() => setPickerOpen(true)} testID="pu-add-item"><Row style={{ gap: 4 }}><Ionicons name="add-circle" size={20} color={colors.brandPrimary} /><Text style={s.addText}>Tambah</Text></Row></Pressable>
            </Row>
            {items.map((it, idx) => {
              const ing = ingMap[it.ingredient_id];
              return (
                <View key={idx} style={s.itemRow}>
                  <Row style={{ justifyContent: "space-between" }}>
                    <Text style={s.itemName}>{ing?.name}</Text>
                    <Pressable onPress={() => setItems((p) => p.filter((_, i) => i !== idx))}><Ionicons name="close-circle" size={20} color={colors.error} /></Pressable>
                  </Row>
                  <Row style={{ gap: spacing.sm }}>
                    <View style={{ flex: 1 }}><Input value={it.qty} onChangeText={(v) => setItems((p) => p.map((x, i) => i === idx ? { ...x, qty: v } : x))} keyboardType="numeric" placeholder={`Jml (${ing?.unit})`} /></View>
                    <View style={{ flex: 1 }}><Input value={it.unit_price} onChangeText={(v) => setItems((p) => p.map((x, i) => i === idx ? { ...x, unit_price: v } : x))} keyboardType="numeric" placeholder="Harga/unit" /></View>
                  </Row>
                  <Text style={s.itemTotal}>= {rupiah((parseFloat(it.qty) || 0) * (parseFloat(it.unit_price) || 0))}</Text>
                </View>
              );
            })}
            <Row style={s.totalRow}><Text style={s.totalL}>Total Pembelian</Text><Text style={s.totalR}>{rupiah(total)}</Text></Row>
            <Button label="Simpan Pembelian" icon="checkmark" loading={saving} onPress={save} testID="pu-save" />
          </KeyboardAwareScrollView>
        </View>
      </View>
      <Modal visible={pickerOpen} animationType="fade" transparent onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={s.pickerBackdrop} onPress={() => setPickerOpen(false)}>
          <View style={s.pickerBox}>
            <Text style={s.pickerTitle}>Pilih Bahan</Text>
            <ScrollView style={{ maxHeight: 380 }}>
              {(ings?.items || []).filter((i: any) => !items.find((x) => x.ingredient_id === i.id)).map((i: any) => (
                <Pressable key={i.id} style={s.pickerRow} onPress={() => { setItems((p) => [...p, { ingredient_id: i.id, qty: "", unit_price: String(i.cost_per_unit) }]); setPickerOpen(false); }} testID={`pu-pick-${i.id}`}>
                  <Text style={s.pickerName}>{i.name}</Text><Text style={s.pickerMeta}>{rupiah(i.cost_per_unit)}/{i.unit}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.surface },
  card: { backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: spacing.lg, gap: 3 },
  no: { fontSize: 16, fontWeight: "800", color: c.onSurface },
  sup: { fontSize: 14, color: c.onSurfaceSecondary },
  items: { fontSize: 13, color: c.muted },
  total: { fontSize: 17, fontWeight: "900", color: c.brandSecondary, marginTop: 2 },
  fab: { position: "absolute", right: spacing.lg, width: 56, height: 56, borderRadius: 28, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center", elevation: 6 },
  backdrop: { flex: 1, backgroundColor: "rgba(44,24,16,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "94%" },
  sheetHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.divider },
  sheetTitle: { fontSize: 19, fontWeight: "900", color: c.onSurface },
  paidRow: { gap: spacing.sm },
  paidChip: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: radius.md, backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.border },
  paidText: { fontSize: 14, fontWeight: "700", color: c.onSurfaceTertiary },
  blockLabel: { fontSize: 15, fontWeight: "800", color: c.onSurface },
  addText: { fontSize: 14, fontWeight: "700", color: c.brandPrimary },
  itemRow: { backgroundColor: c.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, gap: 6 },
  itemName: { fontSize: 15, fontWeight: "700", color: c.onSurface },
  itemTotal: { fontSize: 13, fontWeight: "700", color: c.brandSecondary, textAlign: "right" },
  totalRow: { justifyContent: "space-between", paddingVertical: spacing.md },
  totalL: { fontSize: 16, fontWeight: "800", color: c.onSurface },
  totalR: { fontSize: 20, fontWeight: "900", color: c.brandSecondary },
  pickerBackdrop: { flex: 1, backgroundColor: "rgba(44,24,16,0.5)", justifyContent: "center", padding: spacing.xl },
  pickerBox: { backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.lg },
  pickerTitle: { fontSize: 17, fontWeight: "800", color: c.onSurface, marginBottom: spacing.sm },
  pickerRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.divider },
  pickerName: { fontSize: 15, fontWeight: "600", color: c.onSurface },
  pickerMeta: { fontSize: 13, color: c.muted },
}));
