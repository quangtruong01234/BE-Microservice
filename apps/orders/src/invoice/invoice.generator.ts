import * as PDFDocument from "pdfkit";
import * as fs from "fs";
import * as path from "path";

/** Party (buyer or seller) rendered on the invoice. */
export interface InvoiceParty {
  name: string | null;
  username: string;
  email: string | null;
}

export interface InvoiceLineItem {
  productId: number;
  productName: string;
  skuLabel: string | null;
  quantity: number;
  price: number | string;
}

export interface InvoiceOrder {
  id: number;
  status?: string;
  total: number | string;
  shippingFee: number | string | null;
  discountAmount: number | string | null;
  voucherCode: string | null;
  codAmount: number | string | null;
  paymentMethod: string;
  shippingAddress: string;
  createdAt: Date;
  items: InvoiceLineItem[];
}

export interface InvoiceData {
  order: InvoiceOrder;
  buyer: InvoiceParty;
  seller: InvoiceParty | null;
}

// Roboto (Apache-2.0) ships full Vietnamese coverage; PDFKit's built-in
// Helvetica has no Vietnamese glyphs, so diacritics render as blanks/boxes.
const FONT_REGULAR = "Roboto";
const FONT_BOLD = "Roboto-Bold";
const FONT_FILES: Record<string, string> = {
  [FONT_REGULAR]: "Roboto-Regular.ttf",
  [FONT_BOLD]: "Roboto-Bold.ttf",
};

// Layout constants (A4, 50pt margin → printable x 50..545, y 50..792).
const PAGE_LEFT = 50;
const PAGE_RIGHT = 545;
const CONTENT_BOTTOM = 780; // leave room for the footer/page number

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cod: "Thanh toán khi nhận hàng (COD)",
  vnpay: "VNPay",
  zalopay: "ZaloPay",
};

/**
 * Resolve a bundled font file across dev (ts source tree) and prod (compiled
 * dist). The font is copied next to the compiled bundle via nest-cli assets,
 * but we also fall back to the source tree so the invoice never fails to render
 * because of a missing asset.
 */
function resolveFontPath(fileName: string): string {
  const candidates = [
    path.join(__dirname, "fonts", fileName),
    path.join(__dirname, "invoice", "fonts", fileName),
    path.join(
      process.cwd(),
      "apps",
      "orders",
      "src",
      "invoice",
      "fonts",
      fileName,
    ),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  // Last resort — let PDFKit surface a clear ENOENT rather than silently
  // falling back to a non-Vietnamese font.
  return candidates[0];
}

function registerFonts(doc: PDFKit.PDFDocument): void {
  for (const [fontName, fileName] of Object.entries(FONT_FILES)) {
    doc.registerFont(fontName, resolveFontPath(fileName));
  }
}

function formatVnd(amount: number | string | null | undefined): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(Number(amount ?? 0));
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(value));
}

/**
 * Derive a stable, human-readable invoice number from the order id + creation
 * month. Deterministic (no DB sequence) so re-downloading an invoice always
 * yields the same number.
 */
function buildInvoiceNumber(order: InvoiceOrder): string {
  const created = new Date(order.createdAt);
  const yyyymm = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  })
    .format(created)
    .replace("-", "");
  return `INV-${yyyymm}-${String(order.id).padStart(6, "0")}`;
}

interface ShipTo {
  name: string;
  phone: string;
  address: string;
}

/** shippingAddress is pipe-delimited: name|phone|addr|ward|district|province. */
function parseShipTo(shippingAddress: string): ShipTo {
  const [name, phone, addr, ward, district, province] = shippingAddress
    .split("|")
    .map((part) => (part ?? "").trim());
  const address = [addr, ward, district, province].filter(Boolean).join(", ");
  return {
    name: name || "—",
    phone: phone || "—",
    address: address || "—",
  };
}

const ITEM_COLS = { name: PAGE_LEFT, qty: 320, price: 380, subtotal: 470 };

function drawItemsHeader(doc: PDFKit.PDFDocument): void {
  const headerY = doc.y;
  doc.font(FONT_BOLD).fontSize(10);
  doc.text("Sản phẩm", ITEM_COLS.name, headerY, { width: 260 });
  doc.text("SL", ITEM_COLS.qty, headerY, { width: 50 });
  doc.text("Đơn giá", ITEM_COLS.price, headerY, { width: 80 });
  doc.text("Thành tiền", ITEM_COLS.subtotal, headerY, { width: 80 });
  doc.moveDown(0.3);
  doc
    .moveTo(PAGE_LEFT, doc.y)
    .lineTo(PAGE_RIGHT, doc.y)
    .strokeColor("#000000")
    .stroke();
  doc.moveDown(0.5);
}

export function generateInvoicePdf(data: InvoiceData): Promise<Buffer> {
  const { order, buyer, seller } = data;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    registerFonts(doc);

    const invoiceNumber = buildInvoiceNumber(order);
    const invoiceDate = formatDate(order.createdAt);

    // ---- Header --------------------------------------------------------
    doc.font(FONT_BOLD).fontSize(22).text("TRYBUY", { align: "center" });
    doc.font(FONT_REGULAR).fontSize(12).text("HÓA ĐƠN BÁN HÀNG", {
      align: "center",
    });
    doc.moveDown(0.3);
    doc
      .fontSize(10)
      .text(`Số hóa đơn: ${invoiceNumber}`, { align: "center" })
      .text(`Ngày lập: ${invoiceDate}`, { align: "center" });
    doc.moveDown(1.2);

    // ---- Seller / Buyer two columns -----------------------------------
    const colTop = doc.y;
    const colWidth = 240;

    doc.font(FONT_BOLD).fontSize(11).text("Người bán", PAGE_LEFT, colTop, {
      width: colWidth,
    });
    doc.font(FONT_REGULAR).fontSize(10);
    if (seller) {
      doc.text(seller.name ?? seller.username, { width: colWidth });
      if (seller.email) {
        doc.text(`Email: ${seller.email}`, { width: colWidth });
      }
    } else {
      doc.text("—", { width: colWidth });
    }

    const sellerBottom = doc.y;

    doc.font(FONT_BOLD).fontSize(11).text("Khách hàng", 310, colTop, {
      width: colWidth,
    });
    doc.font(FONT_REGULAR).fontSize(10);
    doc.text(buyer.name ?? buyer.username, 310, doc.y, { width: colWidth });
    if (buyer.email) {
      doc.text(`Email: ${buyer.email}`, 310, doc.y, { width: colWidth });
    }

    doc.y = Math.max(sellerBottom, doc.y);
    doc.x = PAGE_LEFT;
    doc.moveDown(1);

    // ---- Ship-to -------------------------------------------------------
    const shipTo = parseShipTo(order.shippingAddress);
    doc.font(FONT_BOLD).fontSize(11).text("Giao đến", PAGE_LEFT);
    doc.font(FONT_REGULAR).fontSize(10);
    doc.text(`Người nhận: ${shipTo.name}`);
    doc.text(`Điện thoại: ${shipTo.phone}`);
    doc.text(`Địa chỉ: ${shipTo.address}`);
    doc.moveDown(1);

    // ---- Order info ----------------------------------------------------
    doc.font(FONT_BOLD).fontSize(11).text("Thông tin đơn hàng");
    doc.font(FONT_REGULAR).fontSize(10);
    doc.text(`Mã đơn hàng: #${order.id}`);
    doc.text(`Trạng thái: ${order.status ?? "pending"}`);
    doc.text(
      `Phương thức thanh toán: ${
        PAYMENT_METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod
      }`,
    );
    doc.moveDown(1);

    // ---- Items table ---------------------------------------------------
    doc.font(FONT_BOLD).fontSize(12).text("Chi tiết sản phẩm");
    doc.moveDown(0.5);
    drawItemsHeader(doc);

    doc.font(FONT_REGULAR).fontSize(10);
    let goodsSubtotal = 0;
    for (const item of order.items) {
      const lineSubtotal = Number(item.price) * Number(item.quantity);
      goodsSubtotal += lineSubtotal;

      // Page-break guard: start a new page + repeat the header if the row
      // would overflow the printable area.
      if (doc.y > CONTENT_BOTTOM - 40) {
        doc.addPage();
        drawItemsHeader(doc);
        doc.font(FONT_REGULAR).fontSize(10);
      }

      const rowY = doc.y;
      const nameLabel = item.skuLabel
        ? `${item.productName || `Sản phẩm #${item.productId}`}\n${item.skuLabel}`
        : item.productName || `Sản phẩm #${item.productId}`;
      doc.text(nameLabel, ITEM_COLS.name, rowY, { width: 260 });
      const rowEndY = doc.y;
      doc.text(String(item.quantity), ITEM_COLS.qty, rowY, { width: 50 });
      doc.text(formatVnd(item.price), ITEM_COLS.price, rowY, { width: 80 });
      doc.text(formatVnd(lineSubtotal), ITEM_COLS.subtotal, rowY, {
        width: 80,
      });
      doc.y = rowEndY;
      doc.moveDown(0.5);
    }

    doc
      .moveTo(PAGE_LEFT, doc.y)
      .lineTo(PAGE_RIGHT, doc.y)
      .strokeColor("#000000")
      .stroke();
    doc.moveDown(0.5);

    // ---- Totals breakdown ---------------------------------------------
    const shippingFee = Number(order.shippingFee ?? 0);
    const discount = Number(order.discountAmount ?? 0);
    const grandTotal = Number(order.total ?? 0);

    const drawTotalRow = (label: string, value: string, bold = false): void => {
      const rowY = doc.y;
      doc.font(bold ? FONT_BOLD : FONT_REGULAR).fontSize(bold ? 12 : 10);
      doc.text(label, 320, rowY, { width: 130, align: "right" });
      doc.text(value, ITEM_COLS.subtotal, rowY, { width: 80, align: "right" });
      doc.moveDown(0.4);
    };

    drawTotalRow("Tạm tính:", formatVnd(goodsSubtotal));
    drawTotalRow("Phí vận chuyển:", formatVnd(shippingFee));
    if (discount > 0) {
      const discountLabel = order.voucherCode
        ? `Giảm giá (${order.voucherCode}):`
        : "Giảm giá:";
      drawTotalRow(discountLabel, `-${formatVnd(discount)}`);
    }
    drawTotalRow("Tổng cộng:", formatVnd(grandTotal), true);
    if (order.paymentMethod === "cod" && order.codAmount != null) {
      drawTotalRow("Thu hộ (COD):", formatVnd(order.codAmount));
    }

    // ---- Footer + page numbers ----------------------------------------
    doc.moveDown(2);
    doc.font(FONT_REGULAR).fontSize(10);
    doc.text("Cảm ơn quý khách đã mua hàng tại TryBuy.", PAGE_LEFT, doc.y, {
      align: "center",
      width: PAGE_RIGHT - PAGE_LEFT,
    });

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // Drop the bottom margin so writing in the footer band does not trigger
      // an extra auto-paginated blank page.
      const originalBottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .font(FONT_REGULAR)
        .fontSize(8)
        .text(
          `Trang ${i - range.start + 1}/${range.count}`,
          PAGE_LEFT,
          doc.page.height - 35,
          {
            align: "right",
            width: PAGE_RIGHT - PAGE_LEFT,
          },
        );
      doc.page.margins.bottom = originalBottomMargin;
    }

    doc.end();
  });
}
