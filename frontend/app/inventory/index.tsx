import Ionicons from "@react-native-vector-icons/ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FlatList, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useFeedback } from "@/src/components/feedback";
import { Header } from "@/src/components/Header";
import { Badge, Button, Card, EmptyState, Field, Input, Loading, Row } from "@/src/components/ui";
import { fmtDateTime, rupiah } from "@/src/format";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

export default function Inventory() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [editing, setEditing] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [moveFor, setMoveFor] = useState<any>(null);

  const { data, isLoading, refetch } = useQuery({ queryKey: ["ingredients"], queryFn: () => apiFetch("/ingredients") });
  const canEdit = user?.role === "owner" || user?.role === "staff";

  return (
    <View style={s.container}>
      <Header title="Inventaris" back subtitle="Stok bahan baku & kemasan" />
      {isLoading ? <Loading /> : (
        <>
          <Row style={s.summaryRow}>
            <Card style={s.sumCard}><Text style={s.sumLabel}>Nilai Stok</Text><Text style={s.sumVal}>{rupiah(data?.total_value)}</Text></Card>
            <Card style={s.sumCard}><Text style={s.sumLabel}>Stok Kritis</Text><Text style={[s.sumVal, { color: data?.low_count ? colors.error : colors.success }]}>{data?.low_count || 0} bahan</Text></Card>
          </Row>
          <FlatList
            data={data?.items || []}
            keyExtractor={(i: any) => i.id}
            contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 96, gap: spacing.sm }}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={<EmptyState icon="cube-outline" title="Belum ada bahan baku" />}
            renderItem={({ item }) => (
              <Pressable style={s.card} onPress={() => canEdit && setMoveFor(item)} testID={`ing-${item.id}`}>
                <View style={{ flex: 1 }}>
                  <Row style={{ gap: 8 }}>
                    <Text style={s.name}>{item.name}</Text>
                    {item.low ? <Badge label="Menipis" tone="error" /> : null}
                  </Row>
                  <Text style={s.meta}>{item.supplier || "Tanpa supplier"} · {rupiah(item.cost_per_unit)}/{item.unit}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[s.stock, item.low && { color: colors.error }]}>{item.stock} {item.unit}</Text>
                  <Text style={s.min}>min {item.min_stock}</Text>
                </View>
                {canEdit ? <Pressable onPress={() => { setEditing(item); setShowForm(true); }} hitSlop={8} style={{ marginLeft: 8 }} testID={`ing-edit-${item.id}`}><Ionicons name="create-outline" size={20} color={colors.muted} /></Pressable> : null}
              </Pressable>
            )}
          />
          {canEdit ? (
            <Pressable style={[s.fab, { bottom: insets.bottom + 16 }]} onPress={() => { setEditing(null); setShowForm(true); }} testID="ing-add"><Ionicons name="add" size={28} color={colors.onBrandPrimary} /></Pressable>
          ) : null}
        </>
      )}
      {showForm ? <IngredientForm ingredient={editing} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); refetch(); }} /> : null}
      {moveFor ? <StockMove ingredient={moveFor} onClose={() => setMoveFor(null)} onSaved={() => { setMoveFor(null); refetch(); }} /> : null}
    </View>
  );
}

function IngredientForm({ ingredient, onClose, onSaved }: any) {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { toast } = useFeedback();
  const qc = useQueryClient();
  const isEdit = !!ingredient;
  const { data: settings } = useQuery({ queryKey: ["settings-inv"], queryFn: () => apiFetch("/settings") });
  const [name, setName] = useState(ingredient?.name || "");
  const [unit, setUnit] = useState(ingredient?.unit || "gram");
  const [cost, setCost] = useState(ingredient ? String(ingredient.cost_per_unit) : "");
  const [stock, setStock] = useState(ingredient ? String(ingredient.stock) : "0");
  const [minStock, setMinStock] = useState(ingredient ? String(ingredient.min_stock) : "0");
  const [supplier, setSupplier] = useState(ingredient?.supplier || "");
  const [saving, setSaving] = useState(false);
  const units = settings?.units || ["gram", "kg", "ml", "liter", "pcs", "pack", "butir", "bungkus"];

  const save = async () => {
    if (!name.trim()) { toast("Nama bahan wajib diisi", "error"); return; }
    const body = { name: name.trim(), unit, purchase_price: parseFloat(cost) || 0, cost_per_unit: parseFloat(cost) || 0, stock: parseFloat(stock) || 0, min_stock: parseFloat(minStock) || 0, supplier: supplier.trim() };
    setSaving(true);
    try {
      if (isEdit) await apiFetch(`/ingredients/${ingredient.id}`, { method: "PATCH", body });
      else await apiFetch("/ingredients", { method: "POST", body });
      qc.invalidateQueries();
      toast("Bahan disimpan", "success"); onSaved();
    } catch (e: any) { toast(e.message, "error"); } finally { setSaving(false); }
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={[s.sheet, { paddingBottom: insets.bottom }]}>
          <Row style={s.sheetHead}><Text style={s.sheetTitle}>{isEdit ? "Edit Bahan" : "Bahan Baru"}</Text><Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable></Row>
          <KeyboardAwareScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled" bottomOffset={20}>
            <Field label="Nama Bahan"><Input value={name} onChangeText={setName} placeholder="mis. Tepung Terigu" testID="if-name" /></Field>
            <Field label="Satuan">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
                {units.map((u: string) => (
                  <Pressable key={u} onPress={() => setUnit(u)} style={[s.unitChip, unit === u && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }]}>
                    <Text style={[s.unitChipText, unit === u && { color: colors.onBrandPrimary }]}>{u}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </Field>
            <Field label={`Harga per ${unit} (Rp)`}><Input value={cost} onChangeText={setCost} keyboardType="numeric" placeholder="14" testID="if-cost" /></Field>
            <Row style={{ gap: spacing.md }}>
              <View style={{ flex: 1 }}><Field label="Stok Saat Ini"><Input value={stock} onChangeText={setStock} keyboardType="numeric" testID="if-stock" /></Field></View>
              <View style={{ flex: 1 }}><Field label="Stok Minimum"><Input value={minStock} onChangeText={setMinStock} keyboardType="numeric" testID="if-min" /></Field></View>
            </Row>
            <Field label="Supplier (opsional)"><Input value={supplier} onChangeText={setSupplier} placeholder="Nama supplier" /></Field>
            <Button label="Simpan" icon="checkmark" loading={saving} onPress={save} testID="if-save" />
          </KeyboardAwareScrollView>
        </View>
      </View>
    </Modal>
  );
}

function StockMove({ ingredient, onClose, onSaved }: any) {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { toast } = useFeedback();
  const qc = useQueryClient();
  const [type, setType] = useState<"in" | "out" | "adjust">("in");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const { data: history } = useQuery({ queryKey: ["ing-history", ingredient.id], queryFn: () => apiFetch(`/inventory/transactions?ingredient_id=${ingredient.id}&limit=20`) });

  const save = async () => {
    const q = parseFloat(qty);
    if (isNaN(q)) { toast("Jumlah wajib diisi", "error"); return; }
    setSaving(true);
    try {
      await apiFetch("/inventory/transactions", { method: "POST", body: { ingredient_id: ingredient.id, type, qty: q, note } });
      qc.invalidateQueries();
      toast("Stok diperbarui", "success"); onSaved();
    } catch (e: any) { toast(e.message, "error"); } finally { setSaving(false); }
  };

  const TYPES = [{ k: "in", l: "Masuk", i: "arrow-down" }, { k: "out", l: "Keluar", i: "arrow-up" }, { k: "adjust", l: "Setel", i: "swap-vertical" }];

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={[s.sheet, { paddingBottom: insets.bottom }]}>
          <Row style={s.sheetHead}><Text style={s.sheetTitle}>{ingredient.name}</Text><Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable></Row>
          <KeyboardAwareScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled" bottomOffset={20}>
            <Text style={s.stockNow}>Stok saat ini: <Text style={{ fontWeight: "900", color: colors.onSurface }}>{ingredient.stock} {ingredient.unit}</Text></Text>
            <Row style={{ gap: spacing.sm, marginBottom: spacing.md }}>
              {TYPES.map((t) => (
                <Pressable key={t.k} onPress={() => setType(t.k as any)} style={[s.typeCard, type === t.k && { backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary }]}>
                  <Ionicons name={t.i as any} size={20} color={type === t.k ? colors.onBrandTertiary : colors.muted} />
                  <Text style={[s.typeText, type === t.k && { color: colors.onBrandTertiary }]}>{t.l}</Text>
                </Pressable>
              ))}
            </Row>
            <Field label={type === "adjust" ? "Stok Baru (jumlah akhir)" : "Jumlah"}><Input value={qty} onChangeText={setQty} keyboardType="numeric" placeholder="0" testID="sm-qty" /></Field>
            <Field label="Catatan (opsional)"><Input value={note} onChangeText={setNote} placeholder="mis. rusak, restock" /></Field>
            <Button label="Simpan Pergerakan" icon="checkmark" loading={saving} onPress={save} testID="sm-save" />
            <Text style={s.histTitle}>Riwayat Stok</Text>
            {(history || []).map((h: any) => (
              <Row key={h.id} style={s.histRow}>
                <View style={{ flex: 1 }}><Text style={s.histNote}>{h.note}</Text><Text style={s.histTime}>{fmtDateTime(h.created_at)}</Text></View>
                <Text style={[s.histQty, { color: h.qty >= 0 ? colors.success : colors.error }]}>{h.qty >= 0 ? "+" : ""}{h.qty} {h.unit}</Text>
              </Row>
            ))}
          </KeyboardAwareScrollView>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.surface },
  summaryRow: { gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  sumCard: { flex: 1 },
  sumLabel: { fontSize: 13, color: c.muted, fontWeight: "600" },
  sumVal: { fontSize: 18, fontWeight: "900", color: c.onSurface, marginTop: 2 },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: spacing.md },
  name: { fontSize: 15, fontWeight: "800", color: c.onSurface },
  meta: { fontSize: 12, color: c.muted, marginTop: 2 },
  stock: { fontSize: 16, fontWeight: "900", color: c.onSurface },
  min: { fontSize: 12, color: c.muted },
  fab: { position: "absolute", right: spacing.lg, width: 56, height: 56, borderRadius: 28, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center", elevation: 6 },
  backdrop: { flex: 1, backgroundColor: "rgba(44,24,16,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "94%" },
  sheetHead: { justifyContent: "space-between", flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.divider },
  sheetTitle: { fontSize: 19, fontWeight: "900", color: c.onSurface },
  unitChip: { paddingHorizontal: 14, height: 38, borderRadius: radius.pill, justifyContent: "center", backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.border },
  unitChipText: { fontSize: 13, fontWeight: "700", color: c.onSurfaceTertiary },
  stockNow: { fontSize: 15, color: c.muted, marginBottom: spacing.md },
  typeCard: { flex: 1, alignItems: "center", gap: 4, paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.border },
  typeText: { fontSize: 13, fontWeight: "700", color: c.onSurfaceTertiary },
  histTitle: { fontSize: 16, fontWeight: "800", color: c.onSurface, marginTop: spacing.lg, marginBottom: spacing.sm },
  histRow: { justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.divider },
  histNote: { fontSize: 14, color: c.onSurface },
  histTime: { fontSize: 12, color: c.muted },
  histQty: { fontSize: 14, fontWeight: "800" },
}));
