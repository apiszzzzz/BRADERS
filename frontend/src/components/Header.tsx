// Sticky screen header (SafeArea-aware) + a plain Screen wrapper.
import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { makeStyles, spacing, useTheme } from "@/src/theme";

export function Header({ title, subtitle, back, right, testID }: {
  title: string; subtitle?: string; back?: boolean; right?: ReactNode; testID?: string;
}) {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <View style={[s.header, { paddingTop: insets.top + spacing.sm }]} testID={testID}>
      <View style={s.row}>
        {back ? (
          <Pressable onPress={() => router.back()} style={s.backBtn} testID="header-back" hitSlop={8}>
            <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={s.title} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={s.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        {right ? <View>{right}</View> : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  header: {
    backgroundColor: c.surface, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: c.divider,
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 40 },
  backBtn: { width: 32, height: 40, justifyContent: "center", marginLeft: -6 },
  title: { fontSize: 22, fontWeight: "800", color: c.onSurface },
  subtitle: { fontSize: 13, color: c.muted, marginTop: 2 },
}));
