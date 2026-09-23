import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth, type Role } from "@/src/auth";
import { useFeedback } from "@/src/components/feedback";
import { Card, Row } from "@/src/components/ui";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Item = { label: string; sub: string; icon: string; route: string; roles: Role[]; color: string };

export default function More() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { confirm } = useFeedback();

  const ITEMS: Item[] = [
    { label: "Produk & Resep", sub: "Menu, HPP, BOM", icon: "fast-food", route: "/products", roles: ["owner"], color: colors.brandPrimary },
    { label: "Inventaris", sub: "Stok bahan baku", icon: "cube", route: "/inventory", roles: ["owner", "staff", "cashier"], color: colors.info },
    { label: "Pembelian", sub: "Stok masuk", icon: "download", route: "/purchases", roles: ["owner", "staff", "cashier"], color: colors.success },
    { label: "Pengeluaran", sub: "Biaya operasional", icon: "wallet", route: "/expenses", roles: ["owner", "cashier"], color: colors.warning },
    { label: "Pelanggan", sub: "Database & riwayat", icon: "people", route: "/customers", roles: ["owner", "cashier"], color: "#7C3AED" },
    { label: "Marketing", sub: "Promo & voucher", icon: "megaphone", route: "/marketing", roles: ["owner", "cashier"], color: "#DB2777" },
    { label: "Laporan", sub: "Keuangan & penjualan", icon: "bar-chart", route: "/reports", roles: ["owner", "cashier"], color: colors.brandSecondary },
    { label: "Kas / Shift", sub: "Buka & tutup kasir", icon: "server", route: "/cash", roles: ["owner", "cashier"], color: "#0891B2" },
    { label: "Pengaturan", sub: "Bisnis & pengguna", icon: "settings", route: "/settings", roles: ["owner", "cashier"], color: colors.muted },
  ];

  const visible = ITEMS.filter((i) => user && i.roles.includes(user.role));

  return (
    <View style={s.container}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + 24, gap: spacing.md }} showsVerticalScrollIndicator={false}>
        <Card style={{ backgroundColor: colors.surfaceInverse }}>
          <Row style={{ gap: spacing.md }}>
            <View style={s.avatar}><Text style={s.avatarText}>{(user?.name || "B")[0]?.toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{user?.name}</Text>
              <Text style={s.role}>{user?.role_label} · {user?.email}</Text>
            </View>
          </Row>
        </Card>

        <View style={s.grid}>
          {visible.map((i) => (
            <Card key={i.route} style={s.tile} onPress={() => router.push(i.route as any)} testID={`more-${i.label.toLowerCase().replace(/[^a-z]/g, "")}`}>
              <View style={[s.tileIcon, { backgroundColor: i.color + "22" }]}>
                <Ionicons name={i.icon as any} size={24} color={i.color} />
              </View>
              <Text style={s.tileLabel}>{i.label}</Text>
              <Text style={s.tileSub}>{i.sub}</Text>
            </Card>
          ))}
        </View>

        <Card onPress={() => confirm({ title: "Keluar dari akun?", confirmLabel: "Keluar", danger: true, onConfirm: logout })} testID="logout" style={{ marginTop: spacing.sm }}>
          <Row style={{ gap: spacing.md, justifyContent: "center" }}>
            <Ionicons name="log-out-outline" size={20} color={colors.error} />
            <Text style={s.logout}>Keluar</Text>
          </Row>
        </Card>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.surface },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 22, fontWeight: "900", color: c.onBrandPrimary },
  name: { fontSize: 18, fontWeight: "800", color: c.onSurfaceInverse },
  role: { fontSize: 13, color: "#D9C5A8", marginTop: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  tile: { width: "47.5%", flexGrow: 1, gap: 6 },
  tileIcon: { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  tileLabel: { fontSize: 15, fontWeight: "800", color: c.onSurface },
  tileSub: { fontSize: 12, color: c.muted },
  logout: { fontSize: 16, fontWeight: "800", color: c.error },
}));
