import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth";
import { useFeedback } from "@/src/components/feedback";
import { Button, Card, Field, Input } from "@/src/components/ui";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

const DEMO = [
  { role: "Owner", email: "owner@braders.id" },
  { role: "Kasir", email: "kasir@braders.id" },
  { role: "Staff", email: "staff@braders.id" },
];

export default function Login() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const { toast } = useFeedback();
  const router = useRouter();
  const [email, setEmail] = useState("owner@braders.id");
  const [password, setPassword] = useState("braders123");
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);

  const submit = async () => {
    if (!email || !password) {
      toast("Email dan password wajib diisi", "error");
      return;
    }
    setLoading(true);
    try {
      await login(email.trim(), password);
      router.replace("/(tabs)");
    } catch (e: any) {
      toast(e.message || "Gagal masuk", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={s.container}>
      <KeyboardAwareScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing["2xl"], paddingBottom: insets.bottom + spacing.xl, paddingHorizontal: spacing.lg }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={s.brandWrap}>
          <View style={s.logo}>
            <Ionicons name="fast-food" size={40} color={colors.onBrandPrimary} />
          </View>
          <Text style={s.brandName}>BRADERS</Text>
          <Text style={s.tagline}>Churros Lezatoss</Text>
        </View>

        <Card style={{ marginTop: spacing.xl }}>
          <Text style={s.formTitle}>Masuk ke Dasbor</Text>
          <Text style={s.formSub}>Kelola penjualan, stok, dan keuntungan</Text>

          <View style={{ marginTop: spacing.lg }}>
            <Field label="Email">
              <Input
                testID="login-email"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="nama@braders.id"
              />
            </Field>
            <Field label="Password">
              <View>
                <Input
                  testID="login-password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!show}
                  placeholder="••••••••"
                />
                <Pressable onPress={() => setShow((v) => !v)} style={s.eye} hitSlop={8}>
                  <Ionicons name={show ? "eye-off" : "eye"} size={20} color={colors.muted} />
                </Pressable>
              </View>
            </Field>
            <Button label="Masuk" onPress={submit} loading={loading} testID="login-submit" icon="log-in" />
          </View>
        </Card>

        <View style={s.demoBox}>
          <Text style={s.demoTitle}>Akun demo (password: braders123)</Text>
          {DEMO.map((d) => (
            <Pressable key={d.email} style={s.demoRow} testID={`demo-${d.role.toLowerCase()}`} onPress={() => setEmail(d.email)}>
              <Text style={s.demoRole}>{d.role}</Text>
              <Text style={s.demoEmail}>{d.email}</Text>
            </Pressable>
          ))}
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.surface },
  brandWrap: { alignItems: "center", gap: 6 },
  logo: {
    width: 84, height: 84, borderRadius: 24, backgroundColor: c.brandPrimary,
    alignItems: "center", justifyContent: "center", marginBottom: 6,
    shadowColor: c.brandPrimary, shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  brandName: { fontSize: 34, fontWeight: "900", color: c.onSurface, letterSpacing: 1 },
  tagline: { fontSize: 15, color: c.brandSecondary, fontWeight: "700" },
  formTitle: { fontSize: 20, fontWeight: "800", color: c.onSurface },
  formSub: { fontSize: 14, color: c.muted, marginTop: 2 },
  eye: { position: "absolute", right: 12, top: 14 },
  demoBox: { marginTop: spacing.xl, gap: 8 },
  demoTitle: { fontSize: 13, color: c.muted, textAlign: "center", marginBottom: 4, fontWeight: "600" },
  demoRow: {
    flexDirection: "row", justifyContent: "space-between", backgroundColor: c.surfaceSecondary,
    paddingHorizontal: 16, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: c.border,
  },
  demoRole: { fontSize: 14, fontWeight: "700", color: c.onSurface },
  demoEmail: { fontSize: 13, color: c.muted },
}));
