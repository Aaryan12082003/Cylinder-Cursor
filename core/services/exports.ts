import ExcelJS from 'exceljs'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { formatDateOnly, formatTimestamp } from '@shared/dates'
import type { DispatchRow, ReportModel } from '@shared/types'
import type { AppContext } from '../db/database'
import { rows, setting } from '../db/database'
import { BusinessError } from './errors'

type CompanyHeader = {
  name: string
  address: string
  gst: string
  phone: string
  email: string
  logo?: Uint8Array
  logoKind?: 'png' | 'jpg'
}

function companyOf(ctx: AppContext): CompanyHeader {
  const row = rows<{
    name: string
    address: string | null
    gst_number: string | null
    phone: string | null
    email: string | null
    logo_path: string | null
  }>(ctx, `SELECT name, address, gst_number, phone, email, logo_path FROM companies WHERE id = 1`)[0]
  return {
    name: row?.name ?? 'CylinderFlow',
    address: row?.address ?? '',
    gst: row?.gst_number ?? '',
    phone: row?.phone ?? '',
    email: row?.email ?? '',
  }
}

export async function reportToExcel(ctx: AppContext, report: ReportModel): Promise<Uint8Array> {
  const company = companyOf(ctx)
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'CylinderFlow'
  workbook.created = ctx.now()
  const sheet = workbook.addWorksheet(report.title.slice(0, 31))
  sheet.addRow([company.name])
  sheet.addRow([report.title])
  sheet.addRow([report.subtitle])
  sheet.addRow([])
  const header = sheet.addRow(report.columns.map((column) => column.label))
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Calibri' }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } }
    cell.alignment = { vertical: 'middle' }
  })
  for (const row of report.rows) {
    sheet.addRow(report.columns.map((column) => row[column.key] ?? ''))
  }
  if (report.summary.length) {
    sheet.addRow([])
    for (const item of report.summary) sheet.addRow([item.label, item.value])
  }
  sheet.columns.forEach((column) => {
    column.width = 18
  })
  sheet.views = [{ state: 'frozen', ySplit: 5 }]
  const buffer = await workbook.xlsx.writeBuffer()
  return new Uint8Array(buffer)
}

function pdfText(text: string): string {
  const replacements: Record<string, string> = {
    '₹': 'Rs ',
    '…': '...',
    '—': '-',
    '–': '-',
    '“': '"',
    '”': '"',
    '‘': "'",
    '’': "'",
  }
  let out = ''
  for (const char of text) {
    if (replacements[char]) {
      out += replacements[char]
      continue
    }
    const code = char.codePointAt(0) ?? 0
    const latin = code >= 0x20 && code <= 0x7e
    const winAnsi = code >= 0xa0 && code <= 0xff
    out += latin || winAnsi ? char : '?'
  }
  return out
}

function fit(text: string, font: PDFFont, size: number, max: number) {
  const value = pdfText(text || '')
  if (font.widthOfTextAtSize(value, size) <= max) return value
  let next = value
  while (next.length > 1 && font.widthOfTextAtSize(`${next}...`, size) > max) next = next.slice(0, -1)
  return `${next}...`
}

function drawHeader(page: PDFPage, font: PDFFont, bold: PDFFont, company: CompanyHeader, title: string, subtitle: string) {
  page.drawRectangle({ x: 0, y: 802, width: 842, height: 40, color: rgb(0.31, 0.27, 0.9) })
  page.drawText('CylinderFlow', { x: 36, y: 816, size: 12, font: bold, color: rgb(1, 1, 1) })
  page.drawText(fit(company.name, bold, 16, 520), { x: 36, y: 760, size: 16, font: bold, color: rgb(0.06, 0.09, 0.16) })
  const meta = [company.address, company.gst ? `GSTIN ${company.gst}` : '', company.phone, company.email].filter(Boolean).join('  ·  ')
  page.drawText(fit(meta, font, 9, 740), { x: 36, y: 742, size: 9, font, color: rgb(0.39, 0.45, 0.55) })
  page.drawText(fit(title, bold, 14, 740), { x: 36, y: 714, size: 14, font: bold, color: rgb(0.06, 0.09, 0.16) })
  page.drawText(fit(subtitle, font, 9, 740), { x: 36, y: 698, size: 9, font, color: rgb(0.39, 0.45, 0.55) })
}

export async function reportToPdf(ctx: AppContext, report: ReportModel): Promise<Uint8Array> {
  const company = companyOf(ctx)
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const margin = 36
  const rowHeight = 18
  const tableWidth = 770
  const weights = report.columns.map((column) => (column.align === 'right' ? 0.7 : 1.3))
  const weightSum = weights.reduce((sum, value) => sum + value, 0)
  const widths = weights.map((value) => (tableWidth * value) / weightSum)
  let page = pdf.addPage([842, 842])
  drawHeader(page, font, bold, company, report.title, report.subtitle)
  let y = 674
  const drawRow = (values: string[], header = false) => {
    if (y < 48) {
      page = pdf.addPage([842, 842])
      y = 800
    }
    if (header) page.drawRectangle({ x: margin, y: y - 4, width: tableWidth, height: rowHeight, color: rgb(0.93, 0.95, 1) })
    let x = margin
    values.forEach((value, index) => {
      const align = report.columns[index]?.align
      const size = 8
      const text = fit(value, header ? bold : font, size, widths[index] - 8)
      const textWidth = (header ? bold : font).widthOfTextAtSize(text, size)
      const textX = align === 'right' ? x + widths[index] - textWidth - 4 : x + 4
      page.drawText(text, { x: textX, y: y + 2, size, font: header ? bold : font, color: rgb(0.06, 0.09, 0.16) })
      x += widths[index]
    })
    y -= rowHeight
  }
  drawRow(report.columns.map((column) => column.label), true)
  for (const row of report.rows) drawRow(report.columns.map((column) => String(row[column.key] ?? '')))
  y -= 8
  for (const item of report.summary) {
    if (y < 48) {
      page = pdf.addPage([842, 842])
      y = 800
    }
    page.drawText(pdfText(`${item.label}: ${item.value}`), { x: margin, y, size: 9, font: bold, color: rgb(0.31, 0.27, 0.9) })
    y -= 14
  }
  const pages = pdf.getPages()
  pages.forEach((item, index) => {
    item.drawText(pdfText(`Generated ${formatTimestamp(ctx.now().toISOString(), setting(ctx.db, 'date_format', 'dd MMM yyyy'))} · Page ${index + 1} of ${pages.length}`), {
      x: margin,
      y: 24,
      size: 8,
      font,
      color: rgb(0.39, 0.45, 0.55),
    })
  })
  return pdf.save()
}

export async function challanToPdf(ctx: AppContext, dispatch: DispatchRow): Promise<Uint8Array> {
  if (dispatch.reversedAt) throw new BusinessError('This dispatch has been reversed. The original challan is kept for history, and the reversal is on the ledger.')
  const company = companyOf(ctx)
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([595.28, 841.89])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const dateFormat = setting(ctx.db, 'date_format', 'dd MMM yyyy')
  page.drawRectangle({ x: 0, y: 790, width: 595, height: 52, color: rgb(0.31, 0.27, 0.9) })
  page.drawText('DELIVERY CHALLAN', { x: 40, y: 812, size: 16, font: bold, color: rgb(1, 1, 1) })
  page.drawText(dispatch.number, { x: 420, y: 812, size: 12, font: bold, color: rgb(1, 1, 1) })
  page.drawText(fit(company.name, bold, 14, 500), { x: 40, y: 750, size: 14, font: bold, color: rgb(0.06, 0.09, 0.16) })
  const meta = [company.address, company.gst ? `GSTIN ${company.gst}` : '', company.phone].filter(Boolean).join(' · ')
  page.drawText(fit(meta, font, 9, 500), { x: 40, y: 732, size: 9, font, color: rgb(0.39, 0.45, 0.55) })
  const details = [
    ['Date', formatDateOnly(dispatch.date, dateFormat)],
    ['Customer', dispatch.partyName],
    ['Challan', dispatch.challanNumber || '—'],
    ['Vehicle', dispatch.vehicleNumber || '—'],
    ['Driver', dispatch.driverName || '—'],
  ]
  let y = 690
  for (const [label, value] of details) {
    page.drawText(label, { x: 40, y, size: 9, font, color: rgb(0.39, 0.45, 0.55) })
    page.drawText(fit(value, font, 11, 360), { x: 140, y, size: 11, font: bold, color: rgb(0.06, 0.09, 0.16) })
    y -= 18
  }
  y -= 10
  page.drawRectangle({ x: 40, y: y - 6, width: 515, height: 22, color: rgb(0.93, 0.95, 1) })
  page.drawText('Size', { x: 48, y, size: 9, font: bold, color: rgb(0.06, 0.09, 0.16) })
  page.drawText('Condition', { x: 220, y, size: 9, font: bold, color: rgb(0.06, 0.09, 0.16) })
  page.drawText('Quantity', { x: 420, y, size: 9, font: bold, color: rgb(0.06, 0.09, 0.16) })
  y -= 24
  for (const line of dispatch.lines) {
    page.drawText(line.sizeName, { x: 48, y, size: 10, font, color: rgb(0.06, 0.09, 0.16) })
    page.drawText(line.condition, { x: 220, y, size: 10, font, color: rgb(0.06, 0.09, 0.16) })
    page.drawText(String(line.quantity), { x: 420, y, size: 10, font: bold, color: rgb(0.06, 0.09, 0.16) })
    y -= 20
  }
  y -= 8
  page.drawText(`Total cylinders: ${dispatch.totalQuantity}`, { x: 40, y, size: 12, font: bold, color: rgb(0.31, 0.27, 0.9) })
  y -= 28
  if (dispatch.remarks) {
    page.drawText('Remarks', { x: 40, y, size: 9, font, color: rgb(0.39, 0.45, 0.55) })
    y -= 16
    page.drawText(fit(dispatch.remarks, font, 10, 500), { x: 40, y, size: 10, font, color: rgb(0.06, 0.09, 0.16) })
  }
  page.drawText('Received by', { x: 40, y: 120, size: 9, font, color: rgb(0.39, 0.45, 0.55) })
  page.drawText('For ' + fit(company.name, font, 9, 180), { x: 360, y: 120, size: 9, font, color: rgb(0.39, 0.45, 0.55) })
  page.drawLine({ start: { x: 40, y: 100 }, end: { x: 200, y: 100 }, thickness: 0.6, color: rgb(0.8, 0.84, 0.88) })
  page.drawLine({ start: { x: 360, y: 100 }, end: { x: 540, y: 100 }, thickness: 0.6, color: rgb(0.8, 0.84, 0.88) })
  page.drawText(`Prepared by ${dispatch.createdBy}`, { x: 40, y: 48, size: 8, font, color: rgb(0.39, 0.45, 0.55) })
  return pdf.save()
}
