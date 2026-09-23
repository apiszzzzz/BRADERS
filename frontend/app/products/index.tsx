import Ionicons from "@react-native-vector-icons/ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { FlatList, Modal, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch, buildQuery } from "@/src/api";
import { useFeedback } from "@/src/components/feedback";
import { Header } from "@/src/components/Header";
import { Badge, Button, EmptyState, Field, Input, Loading, Row } from "@/src/components/ui";
import { rupiah } from "@/src/format";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

export default function Products() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading, refetch } = useQuery({ queryKey: ["products"], queryFn: () => apiFetch("/products") });

  return (
    <View style={s.container}>
      <Header title="Produk & Resep" back subtitle="Kelola menu, HPP, dan resep" />
      {isLoading ? <Loading /> : (
        <FlatList
          data={data || []}
          keyExtractor={(p: any) => p.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 96, gap: spacing.md }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<EmptyState icon="fast-food-outline" title="Belum ada produk" action={<Button label="Tambah Produk" icon="add" onPress={() => { setEditing(null); setShowForm(true); }} full={false} />} />}
          renderItem={({ item }) => (
            <Pressable style={s.card} onPress={() => { setEditing(item); setShowForm(true); }} testID={`product-edit-${item.id}`}>
              {item.image_url ? <Image source={{ uri: item.image_url }} style={s.thumb} contentFit="cover" /> : <View style={[s.thumb, s.thumbPh]}><Ionicons name="fast-food" size={24} color={colors.onBrandTertiary} /></View>}
              <View style={{ flex: 1, gap: 3 }}>
                <Row style={{ justifyContent: "space-between" }}>
                  <Text style={s.name}>{item.name}</Text>
                  {!item.active ? <Badge label="Nonaktif" tone="error" /> : null}
                </Row>
                <Text style={s.cat}>{item.category_name}</Text>
                <Row style={{ gap: spacing.md }}>
                  <Text style={s.price}>{rupiah(item.price)}</Text>
                  <Text style={s.hpp}>HPP {rupiah(item.est_hpp)}</Text>
                  <Badge label={`Margin ${item.gross_margin}%`} tone={item.gross_margin >= 30 ? "success" : "warning"} />
                </Row>
              </View>
            </Pressable>
          )}
        />
      )}
      <Pressable style={[s.fab, { bottom: insets.bottom + 16 }]} onPress={() => { setEditing(null); setShowForm(true); }} testID="product-add">
        <Ionicons name="add" size={28} color={colors.onBrandPrimary} />
      </Pressable>
      {showForm ? <ProductForm product={editing} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); refetch(); }} /> : null}
    </View>
  );
}

function ProductForm({ product, onClose, onSaved }: { product: any; onClose: () => void; onSaved: () => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { toast, confirm } = useFeedback();
  const qc = useQueryClient();
  const isEdit = !!product;

  const { data: cats } = useQuery({ queryKey: ["categories"], queryFn: () => apiFetch("/categories") });
  const { data: ings } = useQuery({ queryKey: ["ingredients-list"], queryFn: () => apiFetch("/ingredients") });
  const { data: full } = useQuery({ queryKey: ["product", product?.id], queryFn: () => apiFetch(`/products/${product.id}`), enabled: isEdit });

  const [name, setName] = useState(product?.name || "");
  const [categoryId, setCategoryId] = useState(product?.category_id || "");
  const [description, setDescription] = useState(product?.description || "");
  const [price, setPrice] = useState(product ? String(product.price) : "");
  const [imageUrl, setImageUrl] = useState(product?.image_url || "");
  const [active, setActive] = useState(product?.active ?? true);
  const [recipe, setRecipe] = useState<{ ingredient_id: string; qty: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [ingPickerOpen, setIngPickerOpen] = useState(false);

  useEffect(() => {
    if (full?.recipe) setRecipe(full.recipe.map((r: any) => ({ ingredient_id: r.ingredient_id, qty: String(r.qty) })));
  }, [full]);

  const ingMap: Record<string, any> = {};
  (ings?.items || []).forEach((i: any) => (ingMap[i.id] = i));

  const estHpp = recipe.reduce((sum, r) => {
    const ing = ingMap[r.ingredient_id];
    return sum + (ing ? ing.cost_per_unit * (parseFloat(r.qty) || 0) : 0);
  }, 0);
  const priceNum = parseFloat(price) || 0;
  const margin = priceNum ? ((priceNum - estHpp) / priceNum * 100) : 0;

  const save = async () => {
    if (!name.trim()) { toast("Nama produk wajib diisi", "error"); return; }
    if (!categoryId) { toast("Pilih kategori", "error"); return; }
    if (!priceNum) { toast("Harga jual wajib diisi", "error"); return; }
    const body = {
      name: name.trim(), category_id: categoryId, description, price: priceNum, image_url: imageUrl.trim(), active,
      recipe: recipe.filter((r) => r.ingredient_id && parseFloat(r.qty) > 0).map((r) => ({ ingredient_id: r.ingredient_id, qty: parseFloat(r.qty) })),
    };
    setSaving(true);
    try {
      if (isEdit) await apiFetch(`/products/${product.id}`, { method: "PATCH", body });
      else await apiFetch("/products", { method: "POST", body });
      qc.invalidateQueries();
      toast("Produk disimpan", "success");
      onSaved();
    } catch (e: any) { toast(e.message, "error"); }
    finally { setSaving(false); }
  };

  const del = () => {
    confirm({
      title: "Hapus produk?", message: "Produk akan dinonaktifkan (riwayat penjualan tetap tersimpan).",
      danger: true, confirmLabel: "Hapus",
      onConfirm: async () => {
        try { await apiFetch(`/products/${product.id}`, { method: "DELETE" }); qc.invalidateQueries(); toast("Produk dihapus", "success"); onSaved(); }
        catch (e: any) { toast(e.message, "error"); }
      },
    });
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={[s.sheet, { paddingBottom: insets.bottom }]}>
          <Row style={s.sheetHead}>
            <Text style={s.sheetTitle}>{isEdit ? "Edit Produk" : "Produk Baru"}</Text>
            <Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable>
          </Row>
          <KeyboardAwareScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} bottomOffset={20}>
            <Field label="Nama Produk"><Input value={name} onChangeText={setName} placeholder="mis. Classic 15K" testID="pf-name" /></Field>
            <Field label="Kategori">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
                {(cats || []).map((c: any) => (
                  <Pressable key={c.id} onPress={() => setCategoryId(c.id)} testID={`pf-cat-${c.id}`}
                    style={[s.catChip, categoryId === c.id && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }]}>
                    <Text style={[s.catChipText, categoryId === c.id && { color: colors.onBrandPrimary }]}>{c.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </Field>
            <Field label="Harga Jual (Rp)"><Input value={price} onChangeText={setPrice} keyboardType="numeric" placeholder="15000" testID="pf-price" /></Field>
            <Field label="Deskripsi"><Input value={description} onChangeText={setDescription} placeholder="Deskripsi singkat" multiline /></Field>
            <Field label="URL Gambar (opsional)"><Input value={imageUrl} onChangeText={setImageUrl} placeholder="https://…" autoCapitalize="none" /></Field>
            <Row style={s.switchRow}>
              <Text style={s.switchLabel}>Produk Aktif</Text>
              <Switch value={active} onValueChange={setActive} trackColor={{ true: colors.brandPrimary }} testID="pf-active" />
            </Row>

            {/* Recipe / BOM */}
            <View style={s.recipeBox}>
              <Row style={{ justifyContent: "space-between", marginBottom: spacing.sm }}>
                <Text style={s.recipeTitle}>Resep / BOM</Text>
                <Pressable onPress={() => setIngPickerOpen(true)} testID="pf-add-ingredient"><Row style={{ gap: 4 }}><Ionicons name="add-circle" size={20} color={colors.brandPrimary} /><Text style={s.addIngText}>Tambah Bahan</Text></Row></Pressable>
              </Row>
              {recipe.length === 0 ? <Text style={s.emptyRecipe}>Belum ada bahan. HPP akan Rp0.</Text> : null}
              {recipe.map((r, idx) => {
                const ing = ingMap[r.ingredient_id];
                return (
                  <Row key={idx} style={s.recipeRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.recipeName}>{ing?.name || "Bahan"}</Text>
                      <Text style={s.recipeCost}>{rupiah(ing?.cost_per_unit)}/{ing?.unit} · = {rupiah((ing?.cost_per_unit || 0) * (parseFloat(r.qty) || 0))}</Text>
                    </View>
                    <Input value={r.qty} onChangeText={(v) => setRecipe((p) => p.map((x, i) => (i === idx ? { ...x, qty: v } : x)))}
                      keyboardType="numeric" style={s.qtyInput} placeholder="0" />
                    <Text style={s.unit}>{ing?.unit}</Text>
                    <Pressable onPress={() => setRecipe((p) => p.filter((_, i) => i !== idx))} hitSlop={6}><Ionicons name="close-circle" size={22} color={colors.error} /></Pressable>
                  </Row>
                );
              })}
              <View style={s.hppSummary}>
                <Row style={{ justifyContent: "space-between" }}><Text style={s.hppL}>Estimasi HPP</Text><Text style={s.hppV}>{rupiah(estHpp)}</Text></Row>
                <Row style={{ justifyContent: "space-between" }}><Text style={s.hppL}>Laba Kotor / Margin</Text><Text style={[s.hppV, { color: margin >= 30 ? colors.success : colors.warning }]}>{rupiah(priceNum - estHpp)} · {margin.toFixed(0)}%</Text></Row>
              </View>
            </View>

            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              <Button label="Simpan Produk" icon="checkmark" loading={saving} onPress={save} testID="pf-save" />
              {isEdit ? <Button label="Hapus Produk" icon="trash" variant="danger" onPress={del} testID="pf-delete" /> : null}
            </View>
          </KeyboardAwareScrollView>
        </View>
      </View>

      {/* Ingredient picker */}
      <Modal visible={ingPickerOpen} animationType="fade" transparent onRequestClose={() => setIngPickerOpen(false)}>
        <Pressable style={s.pickerBackdrop} onPress={() => setIngPickerOpen(false)}>
          <View style={s.pickerBox}>
            <Text style={s.pickerTitle}>Pilih Bahan</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {(ings?.items || []).filter((i: any) => !recipe.find((r) => r.ingredient_id === i.id)).map((i: any) => (
                <Pressable key={i.id} style={s.pickerRow} onPress={() => { setRecipe((p) => [...p, { ingredient_id: i.id, qty: "" }]); setIngPickerOpen(false); }} testID={`pick-ing-${i.id}`}>
                  <Text style={s.pickerName}>{i.name}</Text>
                  <Text style={s.pickerMeta}>{rupiah(i.cost_per_unit)}/{i.unit}</Text>
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
  card: { flexDirection: "row", gap: spacing.md, backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: spacing.md },
  thumb: { width: 64, height: 64, borderRadius: radius.md },
  thumbPh: { backgroundColor: c.brandTertiary, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 16, fontWeight: "800", color: c.onSurface, flex: 1 },
  cat: { fontSize: 13, color: c.muted },
  price: { fontSize: 15, fontWeight: "800", color: c.brandSecondary },
  hpp: { fontSize: 13, color: c.muted, alignSelf: "center" },
  fab: { position: "absolute", right: spacing.lg, width: 56, height: 56, borderRadius: 28, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center", shadowColor: c.brandPrimary, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  backdrop: { flex: 1, backgroundColor: "rgba(44,24,16,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "94%" },
  sheetHead: { justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.divider },
  sheetTitle: { fontSize: 19, fontWeight: "900", color: c.onSurface },
  catChip: { paddingHorizontal: 16, height: 40, borderRadius: radius.pill, justifyContent: "center", backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.border },
  catChipText: { fontSize: 14, fontWeight: "700", color: c.onSurfaceTertiary },
  switchRow: { justifyContent: "space-between", paddingVertical: spacing.sm, marginBottom: spacing.sm },
  switchLabel: { fontSize: 15, fontWeight: "700", color: c.onSurface },
  recipeBox: { backgroundColor: c.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
  recipeTitle: { fontSize: 16, fontWeight: "800", color: c.onSurface },
  addIngText: { fontSize: 14, fontWeight: "700", color: c.brandPrimary },
  emptyRecipe: { fontSize: 13, color: c.muted, paddingVertical: 8 },
  recipeRow: { gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.divider },
  recipeName: { fontSize: 14, fontWeight: "700", color: c.onSurface },
  recipeCost: { fontSize: 12, color: c.muted },
  qtyInput: { width: 70, minHeight: 40, marginBottom: 0, textAlign: "center", backgroundColor: c.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: c.border, color: c.onSurface, paddingHorizontal: 8 },
  unit: { fontSize: 12, color: c.muted, width: 36 },
  hppSummary: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: c.borderStrong, gap: 4 },
  hppL: { fontSize: 14, color: c.onSurfaceSecondary, fontWeight: "600" },
  hppV: { fontSize: 15, fontWeight: "800", color: c.onSurface },
  pickerBackdrop: { flex: 1, backgroundColor: "rgba(44,24,16,0.5)", justifyContent: "center", padding: spacing.xl },
  pickerBox: { backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.lg },
  pickerTitle: { fontSize: 17, fontWeight: "800", color: c.onSurface, marginBottom: spacing.sm },
  pickerRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.divider },
  pickerName: { fontSize: 15, fontWeight: "600", color: c.onSurface },
  pickerMeta: { fontSize: 13, color: c.muted },
}));
