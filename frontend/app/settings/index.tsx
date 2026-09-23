import Ionicons from "@react-native-vector-icons/ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useFeedback } from "@/src/components/feedback";
import { Header } from "@/src/components/Header";
import { Button, Card, Field, Input, Loading, Row } from "@/src/components/ui";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

export default function Settings() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { toast, confirm } = useFeedback();
  const qc = useQueryClient();
  const router = useRouter();
  const isOwner = user?.role === "owner";

  const { data, isLoading, refetch } = useQuery({ queryKey: ["settings"], queryFn: () => apiFetch("/settings") });
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (data) setForm(data); }, [data]);

  const patch = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const patchPay = (k: string, v: boolean) => setForm((f: any) => ({ ...f, payment_methods: { ...f.payment_methods, [k]: v } }));

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch("/settings", { method: "PATCH", body: {
        business_name: form.business_name, tagline: form.tagline, address: form.address, phone: form.phone,
        logo_url: form.logo_url, receipt_footer: form.receipt_footer, apply_tax: form.apply_tax,
        tax_percent: parseFloat(form.tax_percent) || 0, qris_fee_percent: parseFloat(form.qris_fee_percent) || 0,
        allow_negative_stock: form.allow_negative_stock, payment_methods: form.payment_methods,
      } });
      qc.invalidateQueries(); toast("Pengaturan disimpan", "success");
    } catch (e: any) { toast(e.message, "error"); } finally { setSaving(false); }
  };

  const resetDemo = () => confirm({
    title: "Buat ulang data demo?", message: "Menambahkan transaksi/pengeluaran demo baru. Data lama tetap ada.",
    confirmLabel: "Buat Ulang", onConfirm: async () => {
      try { await apiFetch("/settings/reset-demo", { method: "POST", body: {} }); qc.invalidateQueries(); toast("Data demo dibuat ulang", "success"); }
      catch (e: any) { toast(e.message, "error"); }
    },
  });

  if (isLoading) return <View style={s.container}><Header title="Pengaturan" back /><Loading /></View>;

  return (
    <View style={s.container}>
      <Header title="Pengaturan" back subtitle="Profil bisnis & sistem" />
      <KeyboardAwareScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 24, gap: spacing.md }} keyboardShouldPersistTaps="handled" bottomOffset={20}>
        <Card>
          <Text style={s.section}>Profil Bisnis</Text>
          <View style={{ height: spacing.sm }} />
          <Field label="Nama Bisnis"><Input value={form.business_name} onChangeText={(v) => patch("business_name", v)} editable={isOwner} testID="set-name" /></Field>
          <Field label="Tagline"><Input value={form.tagline} onChangeText={(v) => patch("tagline", v)} editable={isOwner} /></Field>
          <Field label="Alamat"><Input value={form.address} onChangeText={(v) => patch("address", v)} editable={isOwner} multiline /></Field>
          <Field label="Telepon"><Input value={form.phone} onChangeText={(v) => patch("phone", v)} editable={isOwner} keyboardType="phone-pad" /></Field>
          <Field label="Footer Struk"><Input value={form.receipt_footer} onChangeText={(v) => patch("receipt_footer", v)} editable={isOwner} /></Field>
        </Card>

        <Card>
          <Text style={s.section}>Pajak & Biaya</Text>
          <Row style={s.switchRow}>
            <View style={{ flex: 1 }}><Text style={s.switchLabel}>Terapkan Pajak</Text><Text style={s.switchHint}>Pajak hanya berlaku jika diaktifkan</Text></View>
            <Switch value={!!form.apply_tax} onValueChange={(v) => patch("apply_tax", v)} disabled={!isOwner} trackColor={{ true: colors.brandPrimary }} testID="set-tax" />
          </Row>
          {form.apply_tax ? <Field label="Persentase Pajak (%)"><Input value={String(form.tax_percent ?? 0)} onChangeText={(v) => patch("tax_percent", v)} keyboardType="numeric" editable={isOwner} /></Field> : null}
          <Field label="Biaya QRIS / MDR (%)" hint="Dilacak terpisah, tidak mengurangi harga jual/HPP"><Input value={String(form.qris_fee_percent ?? 0)} onChangeText={(v) => patch("qris_fee_percent", v)} keyboardType="numeric" editable={isOwner} testID="set-qris-fee" /></Field>
        </Card>

        <Card>
          <Text style={s.section}>Metode Pembayaran</Text>
          <View style={{ height: spacing.sm }} />
          {[["cash", "Tunai"], ["qris", "QRIS"], ["transfer", "Transfer Bank"], ["other", "Lainnya"]].map(([k, l]) => (
            <Row key={k} style={s.switchRow}>
              <Text style={s.switchLabel}>{l}</Text>
              <Switch value={form.payment_methods?.[k] !== false} onValueChange={(v) => patchPay(k, v)} disabled={!isOwner} trackColor={{ true: colors.brandPrimary }} />
            </Row>
          ))}
        </Card>

        <Card>
          <Text style={s.section}>Inventaris</Text>
          <Row style={s.switchRow}>
            <View style={{ flex: 1 }}><Text style={s.switchLabel}>Izinkan Stok Minus</Text><Text style={s.switchHint}>Penjualan tetap jalan walau stok habis</Text></View>
            <Switch value={!!form.allow_negative_stock} onValueChange={(v) => patch("allow_negative_stock", v)} disabled={!isOwner} trackColor={{ true: colors.brandPrimary }} testID="set-neg-stock" />
          </Row>
        </Card>

        {isOwner ? (
          <>
            <Card onPress={() => router.push("/settings/users")} testID="set-users">
              <Row style={{ justifyContent: "space-between" }}>
                <Row style={{ gap: 12 }}><Ionicons name="people" size={22} color={colors.brandPrimary} /><Text style={s.linkText}>Pengguna & Hak Akses</Text></Row>
                <Ionicons name="chevron-forward" size={20} color={colors.muted} />
              </Row>
            </Card>
            <Button label="Simpan Pengaturan" icon="checkmark" loading={saving} onPress={save} testID="set-save" />
            <Button label="Buat Ulang Data Demo" icon="flask" variant="outline" onPress={resetDemo} testID="set-reset-demo" />
          </>
        ) : null}
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.surface },
  section: { fontSize: 16, fontWeight: "800", color: c.onSurface },
  switchRow: { justifyContent: "space-between", alignItems: "center", paddingVertical: spacing.sm, gap: spacing.md },
  switchLabel: { fontSize: 15, fontWeight: "700", color: c.onSurface },
  switchHint: { fontSize: 12, color: c.muted, marginTop: 2 },
  linkText: { fontSize: 16, fontWeight: "700", color: c.onSurface },
}));
