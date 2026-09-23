import { Platform } from "react-native";

// NativeTabs only on iOS 26+. Older iOS, Android, and web use the classic Tabs.
export const usesNativeTabs =
  Platform.OS === "ios" && parseInt(String(Platform.Version), 10) >= 26;
