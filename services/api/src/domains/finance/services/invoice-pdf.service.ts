import { Injectable, Logger } from '@nestjs/common';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import PDFDocument from 'pdfkit';

/**
 * Data minimal untuk render PDF invoice — dibentuk FinanceService dari
 * formatInvoiceDetail (info order, pelanggan, item, jumlah, status DP/Pelunasan).
 */
export interface InvoicePdfData {
  invoiceId: string;
  orderNumber: string;
  jenis: string; // DP | PELUNASAN
  status: string; // DRAFT | ISSUED | PAID | CANCELLED
  jumlah: number;
  createdAt: Date;
  customerNama: string;
  customerNoHp: string | null;
  items: Array<{ productType: string; qty: number; basePriceSnapshot: number }>;
  services: Array<{ serviceType: string; tarif: number }>;
  subtotal: number;
  discount: number;
  total: number;
  notes: string | null;
}

const rupiah = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

/**
 * Invoice PDF Generator — Fase 9 Bagian 4 (housekeeping placeholder Fase 5).
 *
 * PDFKit (ringan, tanpa browser headless). File disimpan ke local disk
 * `uploads/invoices/` (pola sama dengan upload desain Fase 3) dan
 * di-serve via static `/uploads` — siap di-swap ke S3-compatible nanti.
 */
@Injectable()
export class InvoicePdfService {
  private readonly logger = new Logger(InvoicePdfService.name);

  /**
   * Render PDF ke uploads/invoices/<invoiceId>.pdf.
   * @returns URL relatif file (mis. /uploads/invoices/xxx.pdf)
   */
  async generate(data: InvoicePdfData): Promise<string> {
    const dir = join(process.cwd(), 'uploads', 'invoices');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const fileName = `${data.invoiceId}.pdf`;
    const filePath = join(dir, fileName);

    await new Promise<void>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const stream = createWriteStream(filePath);
      stream.on('finish', () => resolve());
      stream.on('error', reject);
      doc.pipe(stream);

      // ==== Header ====
      doc.fontSize(20).font('Helvetica-Bold').text('MLV Wear');
      doc
        .fontSize(10)
        .font('Helvetica')
        .fillColor('#555555')
        .text('Invoice resmi — dokumen ini dibuat otomatis oleh sistem.');
      doc.moveDown(1);

      doc
        .fillColor('#000000')
        .fontSize(16)
        .font('Helvetica-Bold')
        .text(`INVOICE ${data.jenis}`, { continued: true })
        .fontSize(10)
        .font('Helvetica')
        .text(`   (${data.status})`);
      doc.moveDown(0.5);

      // ==== Info order & pelanggan ====
      doc.fontSize(10).font('Helvetica');
      const infoTop = doc.y;
      doc.text(`No. Order   : ${data.orderNumber}`, 50, infoTop);
      doc.text(`Invoice ID  : ${data.invoiceId}`);
      doc.text(`Tanggal     : ${new Date(data.createdAt).toLocaleDateString('id-ID')}`);
      doc.text(`Pelanggan : ${data.customerNama}`, 320, infoTop);
      if (data.customerNoHp) {
        doc.text(`No. HP    : ${data.customerNoHp}`, 320, doc.y);
      }
      doc.moveDown(1.5);
      doc.x = 50;

      // ==== Tabel item ====
      const col = { name: 50, qty: 330, price: 390, sum: 480 };
      const drawLine = (y: number) =>
        doc.moveTo(50, y).lineTo(545, y).strokeColor('#cccccc').stroke();

      doc.font('Helvetica-Bold');
      const headY = doc.y;
      doc.text('Item', col.name, headY);
      doc.text('Qty', col.qty, headY, { width: 50, align: 'right' });
      doc.text('Harga', col.price, headY, { width: 80, align: 'right' });
      doc.text('Subtotal', col.sum, headY, { width: 65, align: 'right' });
      doc.moveDown(0.3);
      drawLine(doc.y);
      doc.moveDown(0.3);

      doc.font('Helvetica');
      for (const item of data.items) {
        const y = doc.y;
        doc.text(item.productType, col.name, y, { width: 270 });
        doc.text(String(item.qty), col.qty, y, { width: 50, align: 'right' });
        doc.text(rupiah(item.basePriceSnapshot), col.price, y, { width: 80, align: 'right' });
        doc.text(rupiah(item.basePriceSnapshot * item.qty), col.sum, y, {
          width: 65,
          align: 'right',
        });
        doc.moveDown(0.3);
      }

      for (const svc of data.services) {
        const y = doc.y;
        doc.text(`Layanan: ${svc.serviceType}`, col.name, y, { width: 270 });
        doc.text(rupiah(svc.tarif), col.sum, y, { width: 65, align: 'right' });
        doc.moveDown(0.3);
      }

      doc.moveDown(0.3);
      drawLine(doc.y);
      doc.moveDown(0.5);

      // ==== Ringkasan ====
      const summary: Array<[string, string]> = [
        ['Subtotal Order', rupiah(data.subtotal)],
        ...(data.discount > 0
          ? ([['Diskon', `- ${rupiah(data.discount)}`]] as [string, string][])
          : []),
        ['Total Order', rupiah(data.total)],
        [`Tagihan ${data.jenis} ini`, rupiah(data.jumlah)],
      ];
      for (const [label, value] of summary) {
        const y = doc.y;
        const isTagihan = label.startsWith('Tagihan');
        doc.font(isTagihan ? 'Helvetica-Bold' : 'Helvetica');
        doc.text(label, 320, y, { width: 140 });
        doc.text(value, 460, y, { width: 85, align: 'right' });
        doc.moveDown(0.2);
      }

      if (data.notes) {
        doc.moveDown(1);
        doc.font('Helvetica').fontSize(9).fillColor('#555555').text(`Catatan: ${data.notes}`, 50);
      }

      doc.end();
    });

    this.logger.log(`PDF invoice ${data.invoiceId} tersimpan: ${filePath}`);
    return `/uploads/invoices/${fileName}`;
  }
}
