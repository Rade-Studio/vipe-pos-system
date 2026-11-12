import { formatMoney } from "@/components/admin/inventory-shared"
import { formatQuantity } from "@/lib/inventory/units"
import { CountPrintMeta, Signatures, type CountPrintHeader } from "./CountSheetPrint"

export interface CountAdjustmentPrintLine {
  name: string
  unit: string
  expected: number
  counted: number
  difference: number
  differenceValue: number
  reason: string | null
}

const signed = (text: string, value: number) => (value > 0 ? `+${text}` : text)

/**
 * "Acta de ajuste" (S5): expected vs counted for the lines with a
 * difference, in units and pesos, with the total and both signatures.
 */
export function CountAdjustmentPrint({
  header,
  lines,
  countedLines,
}: {
  header: CountPrintHeader
  lines: CountAdjustmentPrintLine[]
  countedLines: number
}) {
  const withDifference = lines
    .filter((line) => line.difference !== 0)
    .sort((a, b) => Math.abs(b.differenceValue) - Math.abs(a.differenceValue))
  const missing = withDifference.reduce((sum, line) => sum + Math.min(line.differenceValue, 0), 0)
  const surplus = withDifference.reduce((sum, line) => sum + Math.max(line.differenceValue, 0), 0)
  return (
    <article role="document" aria-label="Acta de ajuste">
      <h1>Acta de ajuste por conteo · #{header.number}</h1>
      <CountPrintMeta header={header} approverLabel="Revisó y aprobó" />
      <table>
        <thead>
          <tr>
            <th>Artículo</th>
            <th data-num="">Sistema</th>
            <th data-num="">Contado</th>
            <th data-num="">Dif.</th>
            <th data-num="">Dif. $</th>
            <th>Motivo</th>
          </tr>
        </thead>
        <tbody>
          {withDifference.map((line) => (
            <tr key={line.name}>
              <td>{line.name}</td>
              <td data-num="">{formatQuantity(line.expected, line.unit)}</td>
              <td data-num="">{formatQuantity(line.counted, line.unit)}</td>
              <td data-num="">{signed(formatQuantity(line.difference, line.unit), line.difference)}</td>
              <td data-num="">{signed(formatMoney(line.differenceValue), line.differenceValue)}</td>
              <td>{line.reason ?? "—"}</td>
            </tr>
          ))}
          <tr data-group="">
            <td colSpan={4}>
              Faltante {formatMoney(missing)} · Sobrante {formatMoney(surplus)}
            </td>
            <td data-num="">{formatMoney(missing + surplus)}</td>
            <td>Diferencia valorizada total</td>
          </tr>
        </tbody>
      </table>
      <p>
        {countedLines} artículos contados · {countedLines - withDifference.length} sin diferencia. El stock del sistema se ajusta a lo
        contado con movimientos “Ajuste por conteo”.
      </p>
      <Signatures counterName={header.counterName} approverName={header.approverName} approverLabel="Revisó y aprobó" />
    </article>
  )
}
