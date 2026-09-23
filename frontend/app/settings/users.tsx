import Ionicons from "@react-native-vector-icons/ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Modal, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useFeedback } from "@/src/components/feedback";
import { Header } from "@/src/components/Header";
import { Badge, Button, Field, Input, Loading, Row } from "@/src/components/ui";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

const ROLES = [
  { key: "owner", label: "Owner/Admin", desc: "Akses penuh" },
  { key: "cashier", label: "Kasir", desc: "POS, pelanggan, penjualan, laporan dasar" },
  { key: "staff", label: "Staff", desc: "Inventaris & stok" },
];

export default function Users() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user: me } = useAuth();
  const [editing, setEditing] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const { data, isLoading, refetch } = useQuery({ queryKey: ["users"], queryFn: () => apiFetch("/users") });

  return (
    <View style={s.container}>
      <Header title="Pengguna & Akses" back subtitle="Kelola tim BRADERS" />
      {isLoading ? <Loading /> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 96, gap: spacing.sm }}>
          {(data || []).map((u: any) => (
            <Pressable key={u.id} style={s.card} onPress={() => { setEditing(u); setShowForm(true); }} testID={`user-${u.id}`}>
              <View style={s.avatar}><Text style={s.avatarText}>{u.name[0]?.toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <Row style={{ gap: 8 }}><Text style={s.name}>{u.name}</Text>{!u.active ? <Badge label="Nonaktif" tone="error" /> : null}</Row>
                <Text style={s.email}>{u.email}</Text>
              </View>
              <Badge label={u.role_label} tone={u.role === "owner" ? "brand" : u.role === "cashier" ? "info" : "neutral"} />
            </Pressable>
          ))}
        </ScrollView>
      )}
      <Pressable style={[s.fab, { bottom: insets.bottom + 16 }]} onPress={() => { setEditing(null); setShowForm(true); }} testID="user-add"><Ionicons name="person-add" size={24} color={colors.onBrandPrimary} /></Pressable>
      {showForm ? <UserForm user={editing} meId={me?.id} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); refetch(); }} /> : null}
    </View>
  );
}

function UserForm({ user, meId, onClose, onSaved }: any) {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { toast } = useFeedback();
  const qc = useQueryClient();
  const isEdit = !!user;
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(user?.role || "cashier");
  const [active, setActive] = useState(user?.active ?? true);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) { toast("Nama wajib diisi", "error"); return; }
    setSaving(true);
    try {
      if (isEdit) {
        await apiFetch(`/users/${user.id}`, { method: "PATCH", body: { name: name.trim(), role, active, password: password || undefined } });
      } else {
        if (!email.trim() || password.length < 6) { toast("Email valid & password min 6 karakter", "error"); setSaving(false); return; }
        await apiFetch("/users", { method: "POST", body: { name: name.trim(), email: email.trim(), password, role, active } });
      }
      qc.invalidateQueries(); toast("Pengguna disimpan", "success"); onSaved();
    } catch (e: any) { toast(e.message, "error"); } finally { setSaving(false); }
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}><View style={[s.sheet, { paddingBottom: insets.bottom }]}>
        <Row style={s.sheetHead}><Text style={s.sheetTitle}>{isEdit ? "Edit Pengguna" : "Pengguna Baru"}</Text><Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable></Row>
        <KeyboardAwareScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled" bottomOffset={20}>
          <Field label="Nama"><Input value={name} onChangeText={setName} testID="uf-name" /></Field>
          <Field label="Email"><Input value={email} onChangeText={setEmail} editable={!isEdit} autoCapitalize="none" keyboardType="email-address" testID="uf-email" /></Field>
          <Field label={isEdit ? "Password Baru (opsional)" : "Password"}><Input value={password} onChangeText={setPassword} secureTextEntry placeholder={isEdit ? "Kosongkan jika tak diubah" : "min 6 karakter"} testID="uf-password" /></Field>
          <Field label="Peran">
            <View style={{ gap: spacing.sm }}>
              {ROLES.map((r) => (
                <Pressable key={r.key} onPress={() => setRole(r.key)} testID={`uf-role-${r.key}`} style={[s.roleCard, role === r.key && { backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary }]}>
                  <View style={s.radio}>{role === r.key ? <View style={s.radioDot} /> : null}</View>
                  <View style={{ flex: 1 }}><Text style={s.roleLabel}>{r.label}</Text><Text style={s.roleDesc}>{r.desc}</Text></View>
                </Pressable>
              ))}
            </View>
          </Field>
          {isEdit && user.id !== meId ? (
            <Row style={s.switchRow}><Text style={s.switchLabel}>Akun Aktif</Text><Switch value={active} onValueChange={setActive} trackColor={{ true: colors.brandPrimary }} testID="uf-active" /></Row>
          ) : null}
          <Button label="Simpan" icon="checkmark" loading={saving} onPress={save} testID="uf-save" />
        </KeyboardAwareScrollView>
      </View></View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.surface },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: spacing.md },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.brandTertiary, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 18, fontWeight: "800", color: c.onBrandTertiary },
  name: { fontSize: 15, fontWeight: "800", color: c.onSurface },
  email: { fontSize: 13, color: c.muted, marginTop: 2 },
  fab: { position: "absolute", right: spacing.lg, width: 56, height: 56, borderRadius: 28, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center", elevation: 6 },
  backdrop: { flex: 1, backgroundColor: "rgba(44,24,16,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "94%" },
  sheetHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.divider },
  sheetTitle: { fontSize: 19, fontWeight: "900", color: c.onSurface },
  roleCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: spacing.md, borderRadius: radius.md, backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.border },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: c.brandPrimary, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: c.brandPrimary },
  roleLabel: { fontSize: 15, fontWeight: "700", color: c.onSurface },
  roleDesc: { fontSize: 12, color: c.muted },
  switchRow: { justifyContent: "space-between", alignItems: "center", paddingVertical: spacing.sm, marginBottom: spacing.sm },
  switchLabel: { fontSize: 15, fontWeight: "700", color: c.onSurface },
}));
