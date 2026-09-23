// BRADERS design tokens — warm cream / brown / golden yellow palette.
// Keys mirror the `color` block of design_guidelines.json.
import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  surface: "#FAF6ED",
  onSurface: "#2C1810",
  surfaceSecondary: "#F3EAD8",
  onSurfaceSecondary: "#3D2317",
  surfaceTertiary: "#E5D4B7",
  onSurfaceTertiary: "#4E2E1D",
  surfaceInverse: "#2C1810",
  onSurfaceInverse: "#FAF6ED",
  muted: "#78716C",

  brand: "#D97706",
  onBrand: "#FFFFFF",
  brandPrimary: "#D97706",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#B45309",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#FDE68A",
  onBrandTertiary: "#78350F",

  success: "#15803D",
  onSuccess: "#FFFFFF",
  warning: "#B45309",
  onWarning: "#FFFFFF",
  error: "#B91C1C",
  onError: "#FFFFFF",
  info: "#1D4ED8",
  onInfo: "#FFFFFF",

  border: "#E5D4B7",
  borderStrong: "#D97706",
  divider: "#EFE6D5",
};

export type ThemeColors = typeof light;

export const defaultScheme = "light" satisfies ColorScheme;
export const themes: { light: ThemeColors; dark?: ThemeColors } = { light };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

setColorScheme?.(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = system && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, "2xl": 32, "3xl": 48 } as const;
export const radius = { sm: 8, md: 14, lg: 22, pill: 999 } as const;
export const font = { sm: 12, base: 14, lg: 16, xl: 20, "2xl": 24, "3xl": 30 } as const;
