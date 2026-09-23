import Ionicons from "@react-native-vector-icons/ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch, buildQuery } from "@/src/api";
import { useFeedback } from "@/src/components/feedback";
import { QrisModal } from "@/src/components/QrisModal";
import { PrintButton, Receipt } from "@/src/components/Receipt";
import { Badge, Button, EmptyState, Field, Input, Loading, Row } from "@/src/components/ui";
import { PAYMENT_LABELS, rupiah } from "@/src/format";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

type CartItem = { id: string; name: string; price: number; qty: number; image_url?: string };

const PAY_METHODS = [
  { key: "cash", label: "Tunai", icon: "cash" },
  { key: "qris", label: "QRIS", icon: "qr-code" },
  { key: "transfer", label: "Transfer", icon: "swap-horizontal" },
  { key: "other", label: "Lainnya", icon: "ellipsis-horizontal" },
];

export default function POS() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { toast } = useFeedback();
  const qc = useQueryClient();

  const [cat, setCat] = useState("all");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);

  const { data: cats } = useQuery({ queryKey: ["categories"], queryFn: () => apiFetch("/categories") });
  const { data: products, isLoading } = useQuery({
    queryKey: ["pos-products"],
    queryFn: () => apiFetch(`/products${buildQuery({ active_only: true })}`),
  });
  const { data: settings } = useQuery({ queryKey: ["settings-pos"], queryFn: () => apiFetch("/settings") });

  const filtered = useMemo(() => {
    let list = products || [];
    if (cat !== "all") list = list.filter((p: any) => p.category_id === cat);
    if (search.trim()) list = list.filter((p: any) => p.name.toLowerCase().includes(search.trim().toLowerCase()));
    return list;
  }, [products, cat, search]);

  const catOptions = [{ key: "all", label: "Semua" }, ...(cats || []).map((c: any) => ({ key: c.id, label: c.name }))];

  const addToCart = (p: any) => {
    setCart((prev) => {
      const ex = prev.find((x) => x.id === p.id);
      if (ex) return prev.map((x) => (x.id === p.id ? { ...x, qty: x.qty + 1 } : x));
      return [...prev, { id: p.id, name: p.name, price: p.price, qty: 1, image_url: p.image_url }];
    });
  };
  const setQty = (id: string, delta: number) => {
    setCart((prev) =>
      prev.map((x) => (x.id === id ? { ...x, qty: x.qty + delta } : x)).filter((x) => x.qty > 0)
    );
  };
  const removeItem = (id: string) => setCart((prev) => prev.filter((x) => x.id !== id));

  const count = cart.reduce((a, b) => a + b.qty, 0);
  const subtotal = cart.reduce((a, b) => a + b.price * b.qty, 0);

  const paymentMethods = settings?.payment_methods || {};

  return (
    <View style={s.container}>
      <View style={[s.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Kasir</Text>
        <View style={s.searchBox}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput
            testID="pos-search"
            style={s.searchInput}
            placeholder="Cari produk…"
            placeholderTextColor={colors.muted}
            value={search}
            onChangeText={setSearch}
          />
          {search ? (
            <Pressable onPress={() => setSearch("")} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={s.chipWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
          {catOptions.map((o) => {
            const active = o.key === cat;
            return (
              <Pressable key={o.key} onPress={() => setCat(o.key)} testID={`pos-cat-${o.key}`}
                style={[s.chip, active && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }]}>
                <Text style={[s.chipText, active && { color: colors.onBrandPrimary }]}>{o.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {isLoading ? (
        <Loading />
      ) : filtered.length === 0 ? (
        <EmptyState icon="fast-food-outline" title="Produk tidak ditemukan" subtitle="Coba kata kunci atau kategori lain" />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(p: any) => p.id}
          numColumns={2}
          columnWrapperStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg }}
          contentContainerStyle={{ paddingTop: spacing.sm, paddingBottom: count > 0 ? 120 : insets.bottom + 24, gap: spacing.md }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const inCart = cart.find((x) => x.id === item.id);
            return (
              <Pressable style={s.productCard} onPress={() => addToCart(item)} testID={`product-${item.id}`}>
                <View style={s.imgWrap}>
                  {item.image_url ? (
                    <Image source={{ uri: item.image_url }} style={s.img} contentFit="cover" transition={200} />
                  ) : (
                    <View style={[s.img, s.imgPlaceholder]}>
                      <Ionicons name="fast-food" size={30} color={colors.onBrandTertiary} />
                    </View>
                  )}
                  {inCart ? (
                    <View style={s.cartBadge}><Text style={s.cartBadgeText}>{inCart.qty}</Text></View>
                  ) : null}
                </View>
                <Text style={s.productName} numberOfLines={2}>{item.name}</Text>
                <Row style={{ justifyContent: "space-between" }}>
                  <Text style={s.productPrice}>{rupiah(item.price)}</Text>
                  <View style={s.addBtn}><Ionicons name="add" size={18} color={colors.onBrandPrimary} /></View>
                </Row>
              </Pressable>
            );
          }}
        />
      )}

      {count > 0 ? (
        <Pressable style={[s.cartBar, { paddingBottom: insets.bottom + 10 }]} onPress={() => setCartOpen(true)} testID="pos-view-cart">
          <View style={s.cartCount}><Text style={s.cartCountText}>{count}</Text></View>
          <Text style={s.cartBarText}>Lihat Keranjang</Text>
          <Text style={s.cartBarTotal}>{rupiah(subtotal)}</Text>
        </Pressable>
      ) : null}

      <CartCheckout
        visible={cartOpen}
        cart={cart}
        subtotal={subtotal}
        settings={settings}
        paymentMethods={paymentMethods}
        onClose={() => setCartOpen(false)}
        onQtyChange={setQty}
        onRemove={removeItem}
        onCompleted={() => {
          setCart([]);
          setCartOpen(false);
          qc.invalidateQueries();
        }}
      />
    </View>
  );
}

function CartCheckout({ visible, cart, subtotal, settings, paymentMethods, onClose, onQtyChange, onRemove, onCompleted }: any) {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { toast } = useFeedback();

  const [method, setMethod] = useState("cash");
  const [discType, setDiscType] = useState<"none" | "percent" | "fixed">("none");
  const [discValue, setDiscValue] = useState("");
  const [promo, setPromo] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [customer, setCustomer] = useState<any>(null);
  const [custOpen, setCustOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Success / QRIS
  const [successSale, setSuccessSale] = useState<any>(null);
  const [qris, setQris] = useState<any>(null);

  const discAmount = useMemo(() => {
    if (discType === "percent") return Math.min(subtotal, subtotal * (parseFloat(discValue) || 0) / 100);
    if (discType === "fixed") return Math.min(subtotal, parseFloat(discValue) || 0);
    return 0;
  }, [discType, discValue, subtotal]);

  const taxRate = settings?.apply_tax ? (settings?.tax_percent || 0) : 0;
  const preTax = Math.max(0, subtotal - discAmount);
  const tax = Math.round(preTax * taxRate / 100);
  const total = preTax + tax;
  const paid = parseFloat(amountPaid) || 0;
  const change = method === "cash" ? paid - total : 0;

  const reset = () => {
    setMethod("cash"); setDiscType("none"); setDiscValue(""); setPromo(""); setAmountPaid(""); setCustomer(null);
  };

  const checkout = async () => {
    if (method === "cash" && paid < total) {
      toast("Uang bayar kurang dari total", "error");
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch("/sales", {
        method: "POST",
        body: {
          items: cart.map((c: CartItem) => ({ product_id: c.id, qty: c.qty })),
          payment_method: method,
          discount_type: promo ? "none" : discType,
          discount_value: promo ? 0 : (parseFloat(discValue) || 0),
          promo_code: promo.trim(),
          customer_id: customer?.id || "",
          amount_paid: method === "cash" ? paid : undefined,
        },
      });
      if (res.payment) {
        setQris({ ...res.payment, orderNo: res.sale.order_no });
      } else {
        setSuccessSale(res.sale);
      }
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const finishAll = () => {
    setSuccessSale(null);
    setQris(null);
    reset();
    onCompleted();
  };

  const cashQuick = [total, Math.ceil(total / 5000) * 5000, Math.ceil(total / 10000) * 10000, Math.ceil(total / 50000) * 50000]
    .filter((v, i, a) => v > 0 && a.indexOf(v) === i).slice(0, 4);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={[s.sheet, { paddingBottom: insets.bottom }]}>
          <Row style={s.sheetHead}>
            <Text style={s.sheetTitle}>Keranjang ({cart.length})</Text>
            <Pressable onPress={onClose} hitSlop={8} testID="cart-close"><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable>
          </Row>

          <KeyboardAwareScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {cart.map((it: CartItem) => (
              <Row key={it.id} style={s.cartItem}>
                <View style={{ flex: 1 }}>
                  <Text style={s.cartItemName}>{it.name}</Text>
                  <Text style={s.cartItemPrice}>{rupiah(it.price)} × {it.qty} = {rupiah(it.price * it.qty)}</Text>
                </View>
                <Row style={{ gap: spacing.sm }}>
                  <Pressable style={s.qtyBtn} onPress={() => onQtyChange(it.id, -1)} testID={`qty-minus-${it.id}`}><Ionicons name="remove" size={18} color={colors.onSurface} /></Pressable>
                  <Text style={s.qtyText}>{it.qty}</Text>
                  <Pressable style={s.qtyBtn} onPress={() => onQtyChange(it.id, 1)} testID={`qty-plus-${it.id}`}><Ionicons name="add" size={18} color={colors.onSurface} /></Pressable>
                  <Pressable style={s.delBtn} onPress={() => onRemove(it.id)} testID={`remove-${it.id}`}><Ionicons name="trash" size={18} color={colors.error} /></Pressable>
                </Row>
              </Row>
            ))}

            {/* Customer */}
            <Pressable style={s.selectRow} onPress={() => setCustOpen(true)} testID="cart-customer">
              <Ionicons name="person-outline" size={18} color={colors.muted} />
              <Text style={s.selectText}>{customer ? customer.name : "Pelanggan (opsional)"}</Text>
              {customer ? (
                <Pressable onPress={() => setCustomer(null)} hitSlop={8}><Ionicons name="close-circle" size={18} color={colors.muted} /></Pressable>
              ) : <Ionicons name="chevron-forward" size={18} color={colors.muted} />}
            </Pressable>

            {/* Discount */}
            <View style={s.discBox}>
              <Text style={s.blockLabel}>Diskon</Text>
              <Row style={{ gap: spacing.sm }}>
                {(["none", "percent", "fixed"] as const).map((t) => (
                  <Pressable key={t} onPress={() => setDiscType(t)} style={[s.discChip, discType === t && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }]}>
                    <Text style={[s.discChipText, discType === t && { color: colors.onBrandPrimary }]}>{t === "none" ? "Tidak" : t === "percent" ? "%" : "Rp"}</Text>
                  </Pressable>
                ))}
                {discType !== "none" ? (
                  <TextInput style={s.discInput} placeholder={discType === "percent" ? "0%" : "0"} placeholderTextColor={colors.muted}
                    keyboardType="numeric" value={discValue} onChangeText={setDiscValue} testID="cart-discount-value" />
                ) : null}
              </Row>
              <TextInput style={s.promoInput} placeholder="Atau kode promo (mis. LEZATOSS10)" placeholderTextColor={colors.muted}
                autoCapitalize="characters" value={promo} onChangeText={setPromo} testID="cart-promo" />
            </View>

            {/* Payment method */}
            <View>
              <Text style={s.blockLabel}>Metode Pembayaran</Text>
              <View style={s.payGrid}>
                {PAY_METHODS.filter((m) => paymentMethods[m.key] !== false).map((m) => (
                  <Pressable key={m.key} onPress={() => setMethod(m.key)} testID={`pay-${m.key}`}
                    style={[s.payCard, method === m.key && { backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary }]}>
                    <Ionicons name={m.icon as any} size={20} color={method === m.key ? colors.onBrandTertiary : colors.muted} />
                    <Text style={[s.payText, method === m.key && { color: colors.onBrandTertiary }]}>{m.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Cash amount */}
            {method === "cash" ? (
              <View>
                <Text style={s.blockLabel}>Uang Diterima</Text>
                <TextInput style={s.cashInput} placeholder="0" placeholderTextColor={colors.muted}
                  keyboardType="numeric" value={amountPaid} onChangeText={setAmountPaid} testID="cart-amount-paid" />
                <Row style={{ gap: spacing.sm, marginTop: spacing.sm, flexWrap: "wrap" }}>
                  {cashQuick.map((v) => (
                    <Pressable key={v} style={s.quickCash} onPress={() => setAmountPaid(String(v))}>
                      <Text style={s.quickCashText}>{rupiah(v)}</Text>
                    </Pressable>
                  ))}
                </Row>
              </View>
            ) : null}
          </KeyboardAwareScrollView>

          {/* Summary + checkout */}
          <View style={s.summary}>
            <Row style={s.sumLine}><Text style={s.sumL}>Subtotal</Text><Text style={s.sumR}>{rupiah(subtotal)}</Text></Row>
            {discAmount > 0 ? <Row style={s.sumLine}><Text style={s.sumL}>Diskon</Text><Text style={[s.sumR, { color: colors.error }]}>-{rupiah(discAmount)}</Text></Row> : null}
            {tax > 0 ? <Row style={s.sumLine}><Text style={s.sumL}>Pajak {taxRate}%</Text><Text style={s.sumR}>{rupiah(tax)}</Text></Row> : null}
            <Row style={s.sumLine}><Text style={s.totalL}>Total</Text><Text style={s.totalR} testID="cart-total">{rupiah(total)}</Text></Row>
            {method === "cash" && paid > 0 ? (
              <Row style={s.sumLine}><Text style={s.sumL}>Kembalian</Text><Text style={[s.sumR, { color: change >= 0 ? colors.success : colors.error, fontWeight: "800" }]} testID="cart-change">{rupiah(change)}</Text></Row>
            ) : null}
            <Button label={method === "qris" ? "Buat QRIS" : "Selesaikan Transaksi"} icon={method === "qris" ? "qr-code" : "checkmark-circle"}
              loading={loading} onPress={checkout} testID="cart-checkout" />
          </View>
        </View>
      </View>

      {/* Customer picker */}
      <CustomerPicker visible={custOpen} onClose={() => setCustOpen(false)} onSelect={(c: any) => { setCustomer(c); setCustOpen(false); }} />

      {/* Cash success */}
      <Modal visible={!!successSale} animationType="slide" transparent onRequestClose={finishAll}>
        <View style={s.backdrop}>
          <View style={[s.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.md }} showsVerticalScrollIndicator={false}>
              <View style={{ alignItems: "center", gap: 8 }}>
                <View style={[s.successCircle, { backgroundColor: colors.success }]}><Ionicons name="checkmark" size={44} color="#FFFFFF" /></View>
                <Text style={s.successTitle}>Transaksi Berhasil</Text>
                {successSale?.change > 0 ? <Text style={s.changeBig}>Kembalian: {rupiah(successSale.change)}</Text> : null}
              </View>
              {successSale ? <Receipt sale={successSale} business={settings} /> : null}
              {successSale ? <PrintButton sale={successSale} business={settings} /> : null}
              <Button label="Transaksi Baru" icon="add" onPress={finishAll} testID="success-new" />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* QRIS */}
      {qris ? (
        <QrisModal
          visible={!!qris}
          paymentId={qris.id}
          initialQr={qris.qr_string}
          orderNo={qris.orderNo}
          amount={qris.amount}
          business={settings}
          onClose={() => setQris(null)}
          onDone={finishAll}
        />
      ) : null}
    </Modal>
  );
}

function CustomerPicker({ visible, onClose, onSelect }: any) {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { toast } = useFeedback();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const { data, refetch } = useQuery({
    queryKey: ["customers-pick", search],
    queryFn: () => apiFetch(`/customers${buildQuery({ search })}`),
    enabled: visible,
  });

  const create = async () => {
    if (!newName.trim()) { toast("Nama pelanggan wajib diisi", "error"); return; }
    try {
      const c = await apiFetch("/customers", { method: "POST", body: { name: newName.trim(), phone: newPhone.trim() } });
      qc.invalidateQueries({ queryKey: ["customers-pick"] });
      setNewName(""); setNewPhone("");
      onSelect(c);
    } catch (e: any) { toast(e.message, "error"); }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={[s.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <Row style={s.sheetHead}>
            <Text style={s.sheetTitle}>Pilih Pelanggan</Text>
            <Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable>
          </Row>
          <KeyboardAwareScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }} keyboardShouldPersistTaps="handled">
            <Input placeholder="Cari nama / telepon…" value={search} onChangeText={setSearch} testID="cust-search" />
            {(data || []).map((c: any) => (
              <Pressable key={c.id} style={s.custRow} onPress={() => onSelect(c)} testID={`cust-${c.id}`}>
                <View style={s.custAvatar}><Text style={s.custAvatarText}>{c.name[0]?.toUpperCase()}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.custName}>{c.name}</Text>
                  {c.phone ? <Text style={s.custPhone}>{c.phone}</Text> : null}
                </View>
                <Text style={s.custSpend}>{rupiah(c.total_spending)}</Text>
              </Pressable>
            ))}
            <View style={s.newCust}>
              <Text style={s.blockLabel}>Pelanggan Baru</Text>
              <Input placeholder="Nama" value={newName} onChangeText={setNewName} testID="cust-new-name" />
              <View style={{ height: 8 }} />
              <Input placeholder="No. telepon (opsional)" value={newPhone} onChangeText={setNewPhone} keyboardType="phone-pad" testID="cust-new-phone" />
              <View style={{ height: 8 }} />
              <Button label="Tambah & Pilih" icon="person-add" variant="outline" onPress={create} testID="cust-create" />
            </View>
          </KeyboardAwareScrollView>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.surface },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.sm },
  title: { fontSize: 24, fontWeight: "900", color: c.onSurface },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, paddingHorizontal: 14, height: 46, borderWidth: 1, borderColor: c.border },
  searchInput: { flex: 1, fontSize: 15, color: c.onSurface },
  chipWrap: { height: 56, borderBottomWidth: 1, borderBottomColor: c.divider },
  chipRow: { gap: spacing.sm, paddingHorizontal: spacing.lg, alignItems: "center" },
  chip: { height: 36, flexShrink: 0, paddingHorizontal: 16, borderRadius: radius.pill, justifyContent: "center", backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.border },
  chipText: { fontSize: 14, fontWeight: "700", color: c.onSurfaceTertiary },
  productCard: { flex: 1, backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: spacing.sm, gap: 6 },
  imgWrap: { position: "relative" },
  img: { width: "100%", aspectRatio: 1, borderRadius: radius.md },
  imgPlaceholder: { backgroundColor: c.brandTertiary, alignItems: "center", justifyContent: "center" },
  cartBadge: { position: "absolute", top: 6, right: 6, backgroundColor: c.brandPrimary, minWidth: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  cartBadgeText: { color: c.onBrandPrimary, fontSize: 13, fontWeight: "800" },
  productName: { fontSize: 14, fontWeight: "700", color: c.onSurface, minHeight: 36 },
  productPrice: { fontSize: 15, fontWeight: "800", color: c.brandSecondary },
  addBtn: { width: 30, height: 30, borderRadius: 10, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center" },
  cartBar: { position: "absolute", left: spacing.lg, right: spacing.lg, bottom: 0, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: c.brandPrimary, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingTop: 14, marginBottom: 8, shadowColor: c.brandPrimary, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  cartCount: { backgroundColor: "rgba(255,255,255,0.25)", minWidth: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  cartCountText: { color: "#FFFFFF", fontWeight: "800", fontSize: 14 },
  cartBarText: { flex: 1, color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  cartBarTotal: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },

  backdrop: { flex: 1, backgroundColor: "rgba(44,24,16,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "94%" },
  sheetHead: { justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.divider },
  sheetTitle: { fontSize: 19, fontWeight: "900", color: c.onSurface },
  cartItem: { justifyContent: "space-between", paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.divider },
  cartItemName: { fontSize: 15, fontWeight: "700", color: c.onSurface },
  cartItemPrice: { fontSize: 13, color: c.muted, marginTop: 2 },
  qtyBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  qtyText: { fontSize: 16, fontWeight: "800", color: c.onSurface, minWidth: 24, textAlign: "center" },
  delBtn: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  selectRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.surfaceTertiary, padding: 14, borderRadius: radius.md },
  selectText: { flex: 1, fontSize: 15, color: c.onSurface, fontWeight: "600" },
  discBox: { gap: spacing.sm },
  blockLabel: { fontSize: 14, fontWeight: "800", color: c.onSurfaceSecondary, marginBottom: 6 },
  discChip: { paddingHorizontal: 16, height: 40, borderRadius: radius.md, justifyContent: "center", backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.border },
  discChipText: { fontSize: 14, fontWeight: "700", color: c.onSurfaceTertiary },
  discInput: { flex: 1, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, paddingHorizontal: 14, height: 40, fontSize: 15, color: c.onSurface, borderWidth: 1, borderColor: c.border },
  promoInput: { backgroundColor: c.surfaceTertiary, borderRadius: radius.md, paddingHorizontal: 14, height: 44, fontSize: 15, color: c.onSurface, borderWidth: 1, borderColor: c.border },
  payGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  payCard: { width: "47.5%", flexGrow: 1, flexDirection: "row", alignItems: "center", gap: 8, padding: 14, borderRadius: radius.md, backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.border },
  payText: { fontSize: 15, fontWeight: "700", color: c.onSurfaceTertiary },
  cashInput: { backgroundColor: c.surfaceTertiary, borderRadius: radius.md, paddingHorizontal: 14, height: 52, fontSize: 22, fontWeight: "800", color: c.onSurface, borderWidth: 1, borderColor: c.border },
  quickCash: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: c.brandTertiary },
  quickCashText: { fontSize: 13, fontWeight: "700", color: c.onBrandTertiary },
  summary: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: c.divider, gap: 6, backgroundColor: c.surfaceSecondary },
  sumLine: { justifyContent: "space-between" },
  sumL: { fontSize: 14, color: c.muted },
  sumR: { fontSize: 14, fontWeight: "700", color: c.onSurface },
  totalL: { fontSize: 18, fontWeight: "900", color: c.onSurface },
  totalR: { fontSize: 22, fontWeight: "900", color: c.brandSecondary },
  successCircle: { width: 84, height: 84, borderRadius: 42, alignItems: "center", justifyContent: "center", marginTop: spacing.sm },
  successTitle: { fontSize: 22, fontWeight: "900", color: c.onSurface },
  changeBig: { fontSize: 17, fontWeight: "800", color: c.success },
  custRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.divider },
  custAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.brandTertiary, alignItems: "center", justifyContent: "center" },
  custAvatarText: { fontSize: 16, fontWeight: "800", color: c.onBrandTertiary },
  custName: { fontSize: 15, fontWeight: "700", color: c.onSurface },
  custPhone: { fontSize: 13, color: c.muted },
  custSpend: { fontSize: 13, fontWeight: "700", color: c.brandSecondary },
  newCust: { marginTop: spacing.md, padding: spacing.md, backgroundColor: c.surfaceSecondary, borderRadius: radius.md },
}));
