// Toast + confirm dialog provider mounted high in the tree.
import Ionicons from "@react-native-vector-icons/ionicons";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Animated, Modal, Pressable, Text, View } from "react-native";

import { Button } from "@/src/components/ui";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Tone = "success" | "error" | "info";
type Toast = { id: number; message: string; tone: Tone };
type Confirm = {
  title: string; message?: string; confirmLabel?: string; cancelLabel?: string;
  danger?: boolean; onConfirm: () => void;
};

type Ctx = {
  toast: (message: string, tone?: Tone) => void;
  confirm: (c: Confirm) => void;
};
const FeedbackContext = createContext<Ctx>(null as any);

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<Confirm | null>(null);
  const idRef = useRef(0);
  const s = useStyles();
  const { colors } = useTheme();

  const toast = useCallback((message: string, tone: Tone = "info") => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);

  const confirm = useCallback((c: Confirm) => setDialog(c), []);

  const toneIcon = { success: "checkmark-circle", error: "close-circle", info: "information-circle" } as const;
  const toneColor = { success: colors.success, error: colors.error, info: colors.info };

  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}
      <View pointerEvents="box-none" style={s.toastWrap}>
        {toasts.map((t) => (
          <View key={t.id} style={s.toast} testID={`toast-${t.tone}`}>
            <Ionicons name={toneIcon[t.tone]} size={20} color={toneColor[t.tone]} />
            <Text style={s.toastText}>{t.message}</Text>
          </View>
        ))}
      </View>
      <Modal visible={!!dialog} transparent animationType="fade" onRequestClose={() => setDialog(null)}>
        <Pressable style={s.backdrop} onPress={() => setDialog(null)}>
          <Pressable style={s.dialog} onPress={() => {}}>
            <Text style={s.dialogTitle}>{dialog?.title}</Text>
            {dialog?.message ? <Text style={s.dialogMsg}>{dialog.message}</Text> : null}
            <View style={{ flexDirection: "row", gap: spacing.md, marginTop: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Button label={dialog?.cancelLabel || "Batal"} variant="secondary" onPress={() => setDialog(null)} testID="confirm-cancel" />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label={dialog?.confirmLabel || "Ya"}
                  variant={dialog?.danger ? "danger" : "primary"}
                  testID="confirm-ok"
                  onPress={() => {
                    const fn = dialog?.onConfirm;
                    setDialog(null);
                    fn?.();
                  }}
                />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  return useContext(FeedbackContext);
}

const useStyles = makeStyles((c) => ({
  toastWrap: { position: "absolute", top: 60, left: 0, right: 0, alignItems: "center", gap: 8, zIndex: 9999 },
  toast: {
    flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.surfaceInverse,
    paddingHorizontal: 16, paddingVertical: 12, borderRadius: radius.md, maxWidth: "90%",
    shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  toastText: { color: c.onSurfaceInverse, fontSize: 14, fontWeight: "600", flexShrink: 1 },
  backdrop: { flex: 1, backgroundColor: "rgba(44,24,16,0.5)", justifyContent: "center", padding: spacing.xl },
  dialog: { backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.xl },
  dialogTitle: { fontSize: 18, fontWeight: "800", color: c.onSurface, marginBottom: 6 },
  dialogMsg: { fontSize: 14, color: c.muted, lineHeight: 20 },
}));
