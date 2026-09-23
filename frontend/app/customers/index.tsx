import Ionicons from "@react-native-vector-icons/ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FlatList, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch, buildQuery } from "@/src/api";
import { useFeedback } from "@/src/components/feedback";
import { Header } from "@/src/components/Header";
import { Badge, Button, EmptyState, Field, Input, Loading, Row } from "@/src/components/ui";
import { fmtDate, fmtDateTime, rupiah } from "@/src/format";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

export default function Customers() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const { data, isLoading, refetch } = useQuery({ queryKey: ["customers", search], queryFn: () => apiFetch(`/customers${buildQuery({ search })}`) });

  const seg = (c: any) => c.total_orders >= 5 ? { l: "Setia", t: "success" } : c.total_orders >= 2 ? { l: "Reguler", t: "info" } : { l: "Baru", t: "neutral" };

  return (
    <View style={s.container}>
      <Header title="Pelanggan" back subtitle="Database & riwayat belanja" />
      <View style={s.searchWrap}>
        <View style={s.searchBox}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <Input placeholder="Cari nama / telepon…" value={search} onChangeText={setSearch} style={s.searchInput} testID="cust-search" />
        </View>
      </View>
      {isLoading ? <Loading /> : (
        <FlatList
          data={data || []}
          keyExtractor={(c: any) => c.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 96, gap: spacing.sm }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<EmptyState icon="people-outline" title="Belum ada pelanggan" subtitle="Tambahkan pelanggan atau pilih saat transaksi" />}
          renderItem={({ item }) => {
            const g = seg(item);
            return (
              <Pressable style={s.card} onPress={() => setDetail(item)} testID={`cust-row-${item.id}`}>
                <View style={s.avatar}><Text style={s.avatarText}>{item.name[0]?.toUpperCase()}</Text></View>
                <View style={{ flex: 1 }}>
                  <Row style={{ gap: 8 }}><Text style={s.name}>{item.name}</Text><Badge label={g.l} tone={g.t as any} /></Row>
                  <Text style={s.meta}>{item.phone || "Tanpa telepon"} · {item.total_orders} order</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={s.spend}>{rupiah(item.total_spending)}</Text>
                  <Text style={s.last}>{item.last_purchase ? fmtDate(item.last_purchase) : "-"}</Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}
      <Pressable style={[s.fab, { bottom: insets.bottom + 16 }]} onPress={() => setShowForm(true)} testID="cust-add"><Ionicons name="person-add" size={24} color={colors.onBrandPrimary} /></Pressable>
      {showForm ? <CustomerForm onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); refetch(); }} /> : null}
      {detail ? <CustomerDetail customer={detail} onClose={() => setDetail(null)} /> : null}
    </View>
  );
}

function CustomerForm({ onClose, onSaved }: any) {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { toast } = useFeedback();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!name.trim()) { toast("Nama wajib diisi", "error"); return; }
    setSaving(true);
    try { await apiFetch("/customers", { method: "POST", body: { name: name.trim(), phone: phone.trim(), notes } }); qc.invalidateQueries(); toast("Pelanggan ditambah", "success"); onSaved(); }
    catch (e: any) { toast(e.message, "error"); } finally { setSaving(false); }
  };
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}><View style={[s.sheet, { paddingBottom: insets.bottom }]}>
        <Row style={s.sheetHead}><Text style={s.sheetTitle}>Pelanggan Baru</Text><Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable></Row>
        <KeyboardAwareScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled" bottomOffset={20}>
          <Field label="Nama"><Input value={name} onChangeText={setName} testID="cf-name" /></Field>
          <Field label="No. Telepon"><Input value={phone} onChangeText={setPhone} keyboardType="phone-pad" testID="cf-phone" /></Field>
          <Field label="Catatan"><Input value={notes} onChangeText={setNotes} multiline /></Field>
          <Button label="Simpan" icon="checkmark" loading={saving} onPress={save} testID="cf-save" />
        </KeyboardAwareScrollView>
      </View></View>
    </Modal>
  );
}

function CustomerDetail({ customer, onClose }: any) {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { data } = useQuery({ queryKey: ["customer", customer.id], queryFn: () => apiFetch(`/customers/${customer.id}`) });
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}><View style={[s.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Row style={s.sheetHead}><Text style={s.sheetTitle}>{customer.name}</Text><Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable></Row>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
          <Row style={{ gap: spacing.md }}>
            <View style={s.statCard}><Text style={s.statL}>Total Belanja</Text><Text style={s.statV}>{rupiah(customer.total_spending)}</Text></View>
            <View style={s.statCard}><Text style={s.statL}>Jumlah Order</Text><Text style={s.statV}>{customer.total_orders}</Text></View>
          </Row>
          {customer.phone ? <Text style={s.info}>📞 {customer.phone}</Text> : null}
          {customer.notes ? <Text style={s.info}>📝 {customer.notes}</Text> : null}
          <Text style={s.histTitle}>Riwayat Pembelian</Text>
          {(data?.history || []).length === 0 ? <Text style={s.empty}>Belum ada pembelian</Text> : null}
          {(data?.history || []).map((h: any) => (
            <Row key={h.id} style={s.histRow}>
              <View style={{ flex: 1 }}><Text style={s.histNo}>{h.order_no}</Text><Text style={s.histTime}>{fmtDateTime(h.paid_at || h.created_at)}</Text></View>
              <Text style={s.histTotal}>{rupiah(h.total)}</Text>
            </Row>
          ))}
        </ScrollView>
      </View></View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.surface },
  searchWrap: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, paddingHorizontal: 14, borderWidth: 1, borderColor: c.border },
  searchInput: { flex: 1, marginBottom: 0, backgroundColor: "transparent", borderWidth: 0, paddingHorizontal: 0 },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: spacing.md },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.brandTertiary, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 18, fontWeight: "800", color: c.onBrandTertiary },
  name: { fontSize: 15, fontWeight: "800", color: c.onSurface },
  meta: { fontSize: 13, color: c.muted, marginTop: 2 },
  spend: { fontSize: 15, fontWeight: "900", color: c.brandSecondary },
  last: { fontSize: 12, color: c.muted },
  fab: { position: "absolute", right: spacing.lg, width: 56, height: 56, borderRadius: 28, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center", elevation: 6 },
  backdrop: { flex: 1, backgroundColor: "rgba(44,24,16,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "94%" },
  sheetHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.divider },
  sheetTitle: { fontSize: 19, fontWeight: "900", color: c.onSurface },
  statCard: { flex: 1, backgroundColor: c.surfaceSecondary, borderRadius: radius.md, padding: spacing.md },
  statL: { fontSize: 13, color: c.muted },
  statV: { fontSize: 18, fontWeight: "900", color: c.onSurface, marginTop: 2 },
  info: { fontSize: 14, color: c.onSurfaceSecondary },
  histTitle: { fontSize: 16, fontWeight: "800", color: c.onSurface, marginTop: spacing.sm },
  empty: { fontSize: 14, color: c.muted },
  histRow: { justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.divider },
  histNo: { fontSize: 14, fontWeight: "700", color: c.onSurface },
  histTime: { fontSize: 12, color: c.muted },
  histTotal: { fontSize: 15, fontWeight: "800", color: c.brandSecondary },
}));
