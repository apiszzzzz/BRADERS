// Digital receipt view + print/share via expo-print.
import * as Print from "expo-print";
import { Text, View } from "react-native";

import { Button } from "@/src/components/ui";
import { fmtDateTime, PAYMENT_LABELS, rupiah } from "@/src/format";
import { makeStyles, spacing, useTheme } from "@/src/theme";

export type Sale = any;

export function Receipt({ sale, business }: { sale: Sale; business?: { name?: string; tagline?: string; address?: string; phone?: string; footer?: string } }) {
  const s = useStyles();
  const b = business || {};
  return (
    <View style={s.wrap} testID="receipt-view">
      <Text style={s.name}>{b.name || "BRADERS"}</Text>
      <Text style={s.tagline}>{b.tagline || "Churros Lezatoss"}</Text>
      {b.address ? <Text style={s.meta}>{b.address}</Text> : null}
      {b.phone ? <Text style={s.meta}>{b.phone}</Text> : null}
      <View style={s.dash} />
      <RowLine l="No" r={sale.order_no} />
      <RowLine l="Waktu" r={fmtDateTime(sale.paid_at || sale.created_at)} />
      <RowLine l="Kasir" r={sale.cashier?.name || "-"} />
      {sale.customer?.name ? <RowLine l="Pelanggan" r={sale.customer.name} /> : null}
      <View style={s.dash} />
      {sale.items.map((it: any, i: number) => (
        <View key={i} style={{ marginBottom: 4 }}>
          <Text style={s.itemName}>{it.name}</Text>
          <RowLine l={`${it.qty} x ${rupiah(it.price)}`} r={rupiah(it.line_total)} />
        </View>
      ))}
      <View style={s.dash} />
      <RowLine l="Subtotal" r={rupiah(sale.subtotal)} />
      {sale.discount_amount > 0 ? <RowLine l={`Diskon${sale.promo_code ? ` (${sale.promo_code})` : ""}`} r={`-${rupiah(sale.discount_amount)}`} /> : null}
      {sale.tax > 0 ? <RowLine l="Pajak" r={rupiah(sale.tax)} /> : null}
      <RowLine l="TOTAL" r={rupiah(sale.total)} bold />
      <RowLine l="Metode" r={PAYMENT_LABELS[sale.payment_method] || sale.payment_method} />
      {sale.payment_method === "cash" && sale.amount_paid ? (
        <>
          <RowLine l="Bayar" r={rupiah(sale.amount_paid)} />
          <RowLine l="Kembali" r={rupiah(sale.change)} />
        </>
      ) : null}
      <View style={s.dash} />
      <Text style={s.footer}>{b.footer || "Terima kasih sudah mampir di BRADERS!"}</Text>
    </View>
  );
}

function RowLine({ l, r, bold }: { l: string; r: string; bold?: boolean }) {
  const s = useStyles();
  return (
    <View style={s.line}>
      <Text style={[s.lineL, bold && s.bold]}>{l}</Text>
      <Text style={[s.lineR, bold && s.bold]}>{r}</Text>
    </View>
  );
}

export function PrintButton({ sale, business }: { sale: Sale; business?: any }) {
  const print = async () => {
    const b = business || {};
    const rows = sale.items
      .map((it: any) => `<tr><td>${it.name}<br/><small>${it.qty} x ${rupiah(it.price)}</small></td><td style="text-align:right">${rupiah(it.line_total)}</td></tr>`)
      .join("");
    const html = `
      <html><body style="font-family:monospace;padding:16px;max-width:320px">
      <h2 style="text-align:center;margin:0">${b.business_name || "BRADERS"}</h2>
      <p style="text-align:center;margin:2px">${b.tagline || "Churros Lezatoss"}</p>
      <hr/>
      <p>No: ${sale.order_no}<br/>Waktu: ${fmtDateTime(sale.paid_at || sale.created_at)}<br/>Kasir: ${sale.cashier?.name || "-"}</p>
      <hr/>
      <table style="width:100%">${rows}</table>
      <hr/>
      <p style="text-align:right">Subtotal: ${rupiah(sale.subtotal)}<br/>
      ${sale.discount_amount > 0 ? `Diskon: -${rupiah(sale.discount_amount)}<br/>` : ""}
      <b>TOTAL: ${rupiah(sale.total)}</b><br/>
      Metode: ${PAYMENT_LABELS[sale.payment_method] || sale.payment_method}</p>
      <hr/>
      <p style="text-align:center">${b.receipt_footer || "Terima kasih!"}</p>
      </body></html>`;
    try {
      await Print.printAsync({ html });
    } catch {
      /* user cancelled */
    }
  };
  return <Button label="Cetak Struk" icon="print" variant="outline" onPress={print} testID="print-receipt" />;
}

const useStyles = makeStyles((c) => ({
  wrap: { backgroundColor: c.surface, padding: spacing.lg, borderRadius: 14, borderWidth: 1, borderColor: c.border },
  name: { fontSize: 22, fontWeight: "900", color: c.onSurface, textAlign: "center" },
  tagline: { fontSize: 13, color: c.brandSecondary, textAlign: "center", fontWeight: "700" },
  meta: { fontSize: 12, color: c.muted, textAlign: "center" },
  dash: { borderBottomWidth: 1, borderStyle: "dashed", borderColor: c.borderStrong, marginVertical: spacing.sm },
  line: { flexDirection: "row", justifyContent: "space-between", marginVertical: 1 },
  lineL: { fontSize: 13, color: c.onSurfaceSecondary },
  lineR: { fontSize: 13, color: c.onSurface, fontWeight: "600" },
  itemName: { fontSize: 14, fontWeight: "700", color: c.onSurface },
  bold: { fontWeight: "900", fontSize: 15, color: c.onSurface },
  footer: { fontSize: 12, color: c.muted, textAlign: "center", fontStyle: "italic" },
}));
