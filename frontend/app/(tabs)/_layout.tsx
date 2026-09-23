import Ionicons from "@react-native-vector-icons/ionicons";
import { Redirect, Tabs } from "expo-router";
import { Platform } from "react-native";

import { useAuth } from "@/src/auth";
import { Loading } from "@/src/components/ui";
import { usesNativeTabs } from "@/src/navigation";
import { useTheme } from "@/src/theme";

const TABS = [
  { name: "index", label: "Beranda", icon: "home", sf: "house.fill" },
  { name: "pos", label: "Kasir", icon: "cart", sf: "cart.fill" },
  { name: "orders", label: "Pesanan", icon: "receipt", sf: "list.bullet.rectangle.fill" },
  { name: "more", label: "Lainnya", icon: "grid", sf: "square.grid.2x2.fill" },
];

export default function TabsLayout() {
  const { user, loading } = useAuth();
  const { colors } = useTheme();

  if (loading) return <Loading />;
  if (!user) return <Redirect href="/login" />;

  if (usesNativeTabs) {
    const { NativeTabs } = require("expo-router/unstable-native-tabs");
    return (
      <NativeTabs>
        {TABS.map((t) => (
          <NativeTabs.Trigger key={t.name} name={t.name}>
            <NativeTabs.Trigger.Icon sf={t.sf as any} />
            <NativeTabs.Trigger.Label>{t.label}</NativeTabs.Trigger.Label>
          </NativeTabs.Trigger>
        ))}
      </NativeTabs>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.divider,
          ...(Platform.OS === "web" ? { height: 64 } : {}),
        },
        tabBarItemStyle: { alignSelf: "center" },
        tabBarLabelStyle: { fontSize: 12, fontWeight: "700" },
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.label,
            tabBarIcon: ({ color, size }) => <Ionicons name={t.icon as any} size={size} color={color} />,
          }}
        />
      ))}
    </Tabs>
  );
}
