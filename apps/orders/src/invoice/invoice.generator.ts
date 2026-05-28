import * as PDFDocument from "pdfkit";

export function generateInvoicePdf(
  order: {
    id: number;
    status?: string;
    total: number;
    created_at: Date;
    items: Array<{
      product_id: number;
      product_name: string;
      quantity: number;
      price: number;
    }>;
  },
  user: { name: string | null; username: string; email: string },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const invoiceDate = new Date(order.created_at).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    // Header
    doc
      .fontSize(22)
      .font("Helvetica-Bold")
      .text("TRYBUY INVOICE", { align: "center" });
    doc.moveDown(0.3);
    doc
      .fontSize(10)
      .font("Helvetica")
      .text(`Invoice Date: ${invoiceDate}`, { align: "center" });
    doc.moveDown(1.5);

    // Order info
    doc.fontSize(12).font("Helvetica-Bold").text("Order Information");
    doc.moveDown(0.3);
    doc.fontSize(10).font("Helvetica");
    doc.text(`Order ID: ${order.id}`);
    doc.text(`Order Date: ${invoiceDate}`);
    doc.text(`Status: ${order.status ?? "pending"}`);
    doc.moveDown(1);

    // Customer info
    doc.fontSize(12).font("Helvetica-Bold").text("Customer Information");
    doc.moveDown(0.3);
    doc.fontSize(10).font("Helvetica");
    doc.text(`Name: ${user.name ?? user.username}`);
    doc.text(`Email: ${user.email}`);
    doc.moveDown(1);

    // Items table
    doc.fontSize(12).font("Helvetica-Bold").text("Order Items");
    doc.moveDown(0.5);

    const col = { name: 50, qty: 300, price: 370, subtotal: 460 };
    const headerY = doc.y;

    doc.fontSize(10).font("Helvetica-Bold");
    doc.text("Product Name", col.name, headerY, { width: 240 });
    doc.text("Qty", col.qty, headerY, { width: 60 });
    doc.text("Unit Price", col.price, headerY, { width: 80 });
    doc.text("Subtotal", col.subtotal, headerY, { width: 80 });

    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor("#000000").stroke();
    doc.moveDown(0.5);

    doc.font("Helvetica").fontSize(10);
    let runningTotal = 0;
    for (const item of order.items) {
      const subtotal = Number(item.price) * Number(item.quantity);
      runningTotal += subtotal;
      const rowY = doc.y;
      doc.text(
        item.product_name || `Product #${item.product_id}`,
        col.name,
        rowY,
        { width: 240 },
      );
      doc.text(String(item.quantity), col.qty, rowY, { width: 60 });
      doc.text(formatVND(item.price), col.price, rowY, { width: 80 });
      doc.text(formatVND(subtotal), col.subtotal, rowY, { width: 80 });
      doc.moveDown(0.5);
    }

    // Total row
    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor("#000000").stroke();
    doc.moveDown(0.5);
    const totalY = doc.y;
    doc.fontSize(11).font("Helvetica-Bold");
    doc.text("Total:", col.price, totalY, { width: 80 });
    doc.text(formatVND(runningTotal), col.subtotal, totalY, { width: 80 });

    // Footer
    doc.moveDown(3);
    doc
      .fontSize(10)
      .font("Helvetica")
      .text("Thank you for your purchase.", { align: "center" });

    doc.end();
  });
}

function formatVND(amount: number | string): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
  }).format(Number(amount));
}
