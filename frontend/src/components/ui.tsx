// Shared UI primitives for BRADERS. All colors come from the theme.
import Ionicons from "@react-native-vector-icons/ionicons";
import { ReactNode } from "react";
import {
  ActivityIndicator, Pressable, ScrollView, Text, TextInput, TextInputProps, View, ViewStyle,
} from "react-native";

import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

// ---------------------------------------------------------------- Button
export function Button({
  label, onPress, variant = "primary", icon, loading, disabled, testID, small, full = true,
}: {
  label: string; onPress: () => void; variant?: "primary" | "secondary" | "outline" | "danger" | "ghost";
  icon?: string; loading?: boolean; disabled?: boolean; testID?: string; small?: boolean; full?: boolean;
}) {
  const { colors } = useTheme();
  const s = useButtonStyles();
  const bg = {
    primary: colors.brandPrimary, secondary: colors.surfaceTertiary, outline: "transparent",
    danger: colors.error, ghost: "transparent",
  }[variant];
  const fg = {
    primary: colors.onBrandPrimary, secondary: colors.onSurfaceTertiary, outline: colors.brandPrimary,
    danger: colors.onError, ghost: colors.brandPrimary,
  }[variant];
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        s.btn, { backgroundColor: bg }, small && s.btnSmall, !full && { alignSelf: "flex-start" },
        variant === "outline" && { borderWidth: 1.5, borderColor: colors.brandPrimary },
        (disabled || loading) && { opacity: 0.5 }, pressed && { opacity: 0.8 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <>
          {icon ? <Ionicons name={icon as any} size={small ? 16 : 18} color={fg} /> : null}
          <Text style={[s.label, { color: fg }, small && { fontSize: 14 }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}
const useButtonStyles = makeStyles(() => ({
  btn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 14, paddingHorizontal: 20, borderRadius: radius.md, minHeight: 48,
  },
  btnSmall: { paddingVertical: 9, paddingHorizontal: 14, minHeight: 38, borderRadius: radius.sm },
  label: { fontSize: 16, fontWeight: "700" },
}));

// ---------------------------------------------------------------- Card
export function Card({ children, style, onPress, testID }: {
  children: ReactNode; style?: ViewStyle; onPress?: () => void; testID?: string;
}) {
  const s = useCardStyles();
  if (onPress) {
    return (
      <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [s.card, style, pressed && { opacity: 0.85 }]}>
        {children}
      </Pressable>
    );
  }
  return <View testID={testID} style={[s.card, style]}>{children}</View>;
}
const useCardStyles = makeStyles((c) => ({
  card: {
    backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: c.border,
    shadowColor: "#3D2317", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
}));

// ---------------------------------------------------------------- Input
export function Field({ label, error, children, hint }: {
  label?: string; error?: string; children: ReactNode; hint?: string;
}) {
  const s = useFieldStyles();
  return (
    <View style={s.wrap}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      {children}
      {hint && !error ? <Text style={s.hint}>{hint}</Text> : null}
      {error ? <Text style={s.error}>{error}</Text> : null}
    </View>
  );
}

export function Input(props: TextInputProps & { testID?: string }) {
  const { colors } = useTheme();
  const s = useFieldStyles();
  return (
    <TextInput
      placeholderTextColor={colors.muted}
      style={s.input}
      {...props}
    />
  );
}
const useFieldStyles = makeStyles((c) => ({
  wrap: { gap: 6, marginBottom: spacing.md },
  label: { fontSize: 14, fontWeight: "700", color: c.onSurfaceSecondary },
  hint: { fontSize: 12, color: c.muted },
  error: { fontSize: 12, color: c.error, fontWeight: "600" },
  input: {
    backgroundColor: c.surfaceTertiary, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, color: c.onSurface, borderWidth: 1, borderColor: c.border, minHeight: 48,
  },
}));

// ---------------------------------------------------------------- Chips row (horizontal scroller)
export function ChipRow({ options, value, onChange, testIDPrefix }: {
  options: { key: string; label: string }[]; value: string; onChange: (k: string) => void; testIDPrefix?: string;
}) {
  const s = useChipStyles();
  const { colors } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={s.row}
      contentContainerStyle={s.rowContent}
    >
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            testID={testIDPrefix ? `${testIDPrefix}-${o.key}` : undefined}
            onPress={() => onChange(o.key)}
            style={[s.chip, active ? { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary } : null]}
          >
            <Text style={[s.chipText, active ? { color: colors.onBrandPrimary } : null]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
const useChipStyles = makeStyles((c) => ({
  row: { height: 56 },
  rowContent: { gap: spacing.sm, paddingHorizontal: spacing.lg, alignItems: "center" },
  chip: {
    height: 36, flexShrink: 0, paddingHorizontal: 16, borderRadius: radius.pill, justifyContent: "center",
    backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.border,
  },
  chipText: { fontSize: 14, fontWeight: "600", color: c.onSurfaceTertiary },
}));

// ---------------------------------------------------------------- State views
export function Loading({ label }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 12 }}>
      <ActivityIndicator size="large" color={colors.brandPrimary} />
      {label ? <Text style={{ color: colors.muted, fontSize: 14 }}>{label}</Text> : null}
    </View>
  );
}

export function EmptyState({ icon = "cube-outline", title, subtitle, action, testID }: {
  icon?: string; title: string; subtitle?: string; action?: ReactNode; testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={{ alignItems: "center", justifyContent: "center", padding: 40, gap: 10 }}>
      <View style={{
        width: 72, height: 72, borderRadius: 36, backgroundColor: colors.brandTertiary,
        alignItems: "center", justifyContent: "center",
      }}>
        <Ionicons name={icon as any} size={34} color={colors.onBrandTertiary} />
      </View>
      <Text style={{ fontSize: 17, fontWeight: "800", color: colors.onSurface, textAlign: "center" }}>{title}</Text>
      {subtitle ? (
        <Text style={{ fontSize: 14, color: colors.muted, textAlign: "center", maxWidth: 280 }}>{subtitle}</Text>
      ) : null}
      {action ? <View style={{ marginTop: 8 }}>{action}</View> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: "center", justifyContent: "center", padding: 40, gap: 12 }}>
      <Ionicons name="alert-circle-outline" size={40} color={colors.error} />
      <Text style={{ fontSize: 15, color: colors.onSurface, textAlign: "center" }}>{message || "Terjadi kesalahan"}</Text>
      {onRetry ? <Button label="Coba Lagi" onPress={onRetry} variant="outline" full={false} icon="refresh" /> : null}
    </View>
  );
}

// ---------------------------------------------------------------- Badge
export function Badge({ label, tone = "neutral" }: {
  label: string; tone?: "neutral" | "success" | "warning" | "error" | "info" | "brand";
}) {
  const { colors } = useTheme();
  const map = {
    neutral: [colors.surfaceTertiary, colors.onSurfaceTertiary],
    success: [colors.brandTertiary, colors.success],
    warning: ["#FEF3C7", colors.warning],
    error: ["#FEE2E2", colors.error],
    info: ["#DBEAFE", colors.info],
    brand: [colors.brandTertiary, colors.onBrandTertiary],
  }[tone];
  return (
    <View style={{ backgroundColor: map[0], paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, alignSelf: "flex-start" }}>
      <Text style={{ color: map[1], fontSize: 12, fontWeight: "700" }}>{label}</Text>
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: "row", alignItems: "center" }, style]}>{children}</View>;
}
