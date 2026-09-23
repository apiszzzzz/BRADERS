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

export default function Expenses() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [showForm, setShowForm] = useState(false);
  const { data, isLoading, refetch } = useQuery({ queryKey: ["expenses"], queryFn: () => apiFetch("/expenses") });

  const total = (data || []).reduce((a: number, e: any) => a + e.amount, 0);

  return (
    <View style={s.container}>
      <Header title="Pengeluaran" back subtitle="Biaya operasional" />
      {isLoading ? <Loading /> : (
        <FlatList
          data={data || []}
          keyExtractor={(e: any) => e.id}
          ListHeaderComponent={
            <View style={s.totalCard}>
              <Text style={s.totalLabel}>Total Pengeluaran Tercatat</Text>
              <Text style={s.totalVal}>{rupiah(total)}</Text>
            </View>
          }
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 96, gap: spacing.sm }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<EmptyState icon="wallet-outline" title="Belum ada pengeluaran" action={<Button label="Catat Pengeluaran" icon="add" onPress={() => setShowForm(true)} full={false} />} />}
          renderItem={({ item }) => (
            <View style={s.card}>
              <View style={s.catIcon}><Ionicons name="pricetag" size={18} color={colors.warning} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.cat}>{item.category}</Text>
                <Text style={s.desc}>{item.description || "-"} · {fmtDate(item.date)}</Text>
              </View>
              <Text style={s.amount}>-{rupiah(item.amount)}</Text>
            </View>
          )}
        />
      )}
      <Pressable style={[s.fab, { bottom: insets.bottom + 16 }]} onPress={() => setShowForm(true)} testID="expense-add"><Ionicons name="add" size={28} color={colors.onBrandPrimary} /></Pressable>
      {showForm ? <ExpenseForm onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); refetch(); }} /> : null}
    </View>
  );
}

function ExpenseForm({ onClose, onSaved }: any) {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { toast } = useFeedback();
  const qc = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ["settings-exp"], queryFn: () => apiFetch("/settings") });
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState("cash");
  const [saving, setSaving] = useState(false);
  const cats = settings?.expense_categories || [];

  const save = async () => {
    if (!category) { toast("Pilih kategori", "error"); return; }
    if (!parseFloat(amount)) { toast("Jumlah wajib diisi", "error"); return; }
    setSaving(true);
    try {
      await apiFetch("/expenses", { method: "POST", body: { category, amount: parseFloat(amount), description, date, payment_method: method } });
      qc.invalidateQueries();
      toast("Pengeluaran dicatat", "success"); onSaved();
    } catch (e: any) { toast(e.message, "error"); } finally { setSaving(false); }
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={[s.sheet, { paddingBottom: insets.bottom }]}>
          <Row style={s.sheetHead}><Text style={s.sheetTitle}>Pengeluaran Baru</Text><Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable></Row>
          <KeyboardAwareScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled" bottomOffset={20}>
            <Field label="Kategori">
              <View style={s.catGrid}>
                {cats.map((cat: string) => (
                  <Pressable key={cat} onPress={() => setCategory(cat)} testID={`exp-cat-${cat}`} style={[s.catChip, category === cat && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }]}>
                    <Text style={[s.catChipText, category === cat && { color: colors.onBrandPrimary }]}>{cat}</Text>
                  </Pressable>
                ))}
              </View>
            </Field>
            <Field label="Jumlah (Rp)"><Input value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="0" testID="exp-amount" /></Field>
            <Field label="Tanggal"><Input value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" testID="exp-date" /></Field>
            <Field label="Keterangan"><Input value={description} onChangeText={setDescription} placeholder="Keterangan singkat" /></Field>
            <Field label="Metode Pembayaran">
              <Row style={{ gap: spacing.sm }}>
                {["cash", "transfer", "qris"].map((m) => (
                  <Pressable key={m} onPress={() => setMethod(m)} style={[s.methodChip, method === m && { backgroundColor: colors.brandPrimary }]}>
                    <Text style={[s.methodText, method === m && { color: colors.onBrandPrimary }]}>{m === "cash" ? "Tunai" : m === "transfer" ? "Transfer" : "QRIS"}</Text>
                  </Pressable>
                ))}
              </Row>
            </Field>
            <Button label="Simpan Pengeluaran" icon="checkmark" loading={saving} onPress={save} testID="exp-save" />
          </KeyboardAwareScrollView>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.surface },
  totalCard: { backgroundColor: c.surfaceInverse, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  totalLabel: { fontSize: 13, color: "#D9C5A8", fontWeight: "600" },
  totalVal: { fontSize: 26, fontWeight: "900", color: c.onSurfaceInverse, marginTop: 2 },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: spacing.md },
  catIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: "#FEF3C7", alignItems: "center", justifyContent: "center" },
  cat: { fontSize: 15, fontWeight: "800", color: c.onSurface },
  desc: { fontSize: 13, color: c.muted, marginTop: 2 },
  amount: { fontSize: 16, fontWeight: "900", color: c.error },
  fab: { position: "absolute", right: spacing.lg, width: 56, height: 56, borderRadius: 28, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center", elevation: 6 },
  backdrop: { flex: 1, backgroundColor: "rgba(44,24,16,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "94%" },
  sheetHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.divider },
  sheetTitle: { fontSize: 19, fontWeight: "900", color: c.onSurface },
  catGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  catChip: { paddingHorizontal: 14, height: 38, borderRadius: radius.pill, justifyContent: "center", backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.border },
  catChipText: { fontSize: 13, fontWeight: "700", color: c.onSurfaceTertiary },
  methodChip: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: radius.md, backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.border },
  methodText: { fontSize: 14, fontWeight: "700", color: c.onSurfaceTertiary },
}));
