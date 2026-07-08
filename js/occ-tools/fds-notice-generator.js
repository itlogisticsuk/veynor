(function () {
  "use strict";

  function getJsPdf() {
    return window.jspdf?.jsPDF || window.jsPDF || null;
  }

  function formatNumber(value, digits = 0) {
    const num = Number(value ?? 0);
    if (!Number.isFinite(num)) return "0";

    return num.toLocaleString("en-GB", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function clean(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function getOrderPackages(order) {
    return Number(order?.planning_colli || order?.colli || 0);
  }

  function getOrderVolume(order) {
    return Number(order?.planning_volume_m3 || order?.volume_m3 || 0);
  }

  function getOrderWeight(order) {
    const direct =
      Number(order?.planning_weight_kg || 0) ||
      Number(order?.weight_kg || 0) ||
      Number(order?.total_weight_kg || 0);

    if (direct > 0) return direct;

    return (order.order_lines || []).reduce((sum, line) => {
      const qty = Number(line.quantity_ordered || line.quantity || 1);

      const lineWeight =
        Number(line.total_line_weight_kg || 0) ||
        Number(line.total_weight_kg || 0) ||
        (Number(line.unit_weight_kg || 0) * qty) ||
        (Number(line.products?.weight_kg || 0) * qty) ||
        (Number(line.products?.net_weight_kg || 0) * qty) ||
        0;

      return sum + lineWeight;
    }, 0);
  }

  function getAddress(order) {
    return [
      order.delivery_address_1,
      order.delivery_address_2,
      order.delivery_address_3,
      order.delivery_city,
      order.delivery_postcode
    ]
      .map(clean)
      .filter(Boolean)
      .join(", ");
  }

  function getRetailer(order) {
    return clean(
      order.retailer_name ||
      order.retail_name ||
      order.delivery_name ||
      order.recipient_name ||
      "—"
    );
  }

  async function generate({ vehicle, orders, logoUrl }) {
    const JsPDF = getJsPdf();

    if (!JsPDF) {
      throw new Error("jsPDF is not loaded.");
    }

    if (!orders?.length) {
      throw new Error("No FDS orders found.");
    }

    const doc = new JsPDF("p", "mm", "a4");

    const totalPackages = orders.reduce((s, o) => s + getOrderPackages(o), 0);
    const totalVolume = orders.reduce((s, o) => s + getOrderVolume(o), 0);
    const totalWeight = orders.reduce((s, o) => s + getOrderWeight(o), 0);

    let y = 14;

    if (logoUrl) {
      try {
        doc.addImage(logoUrl, "PNG", 14, 10, 28, 18);
      } catch (error) {
        console.warn("Logo skipped:", error);
      }
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.text("FDS COLLECTION NOTICE", 50, 18);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Carrier: ${clean(vehicle?.name || vehicle?.vehicle_name || "FDS")}`, 50, 25);
    doc.text(`Generated: ${new Date().toLocaleString("en-GB")}`, 50, 30);

    y = 42;

    doc.setDrawColor(220, 225, 235);
    doc.roundedRect(14, y, 182, 24, 3, 3);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(`Orders: ${orders.length}`, 20, y + 8);
    doc.text(`Packages: ${formatNumber(totalPackages)}`, 58, y + 8);
    doc.text(`Volume: ${formatNumber(totalVolume, 2)} m³`, 108, y + 8);
    doc.text(`Weight: ${formatNumber(totalWeight, 0)} kg`, 158, y + 8);

    y += 36;

    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");

    doc.text("SO", 14, y);
    doc.text("ACK", 35, y);
    doc.text("Retailer", 58, y);
    doc.text("Postcode", 118, y);
    doc.text("Packages", 142, y);
    doc.text("m³", 164, y);
    doc.text("kg", 180, y);

    y += 3;
    doc.setDrawColor(220, 225, 235);
    doc.line(14, y, 196, y);
    y += 6;

    orders.forEach((order, index) => {
      if (y > 258) {
        doc.addPage();
        y = 18;
      }

      const rowHeight = 13;

      if (index % 2 === 1) {
        doc.setFillColor(226, 232, 240);
        doc.rect(14, y - 4, 182, rowHeight, "F");
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(7, 21, 47);
      doc.text(clean(order.order_number || "—"), 14, y);

      doc.setTextColor(0, 0, 0);
      doc.text(clean(order.external_reference || "—"), 35, y);

      doc.setFont("helvetica", "bold");
      doc.text(getRetailer(order).slice(0, 32), 58, y);

      doc.setFont("helvetica", "normal");
      doc.text(clean(order.delivery_postcode || "—"), 118, y);
      doc.text(formatNumber(getOrderPackages(order)), 142, y);
      doc.text(formatNumber(getOrderVolume(order), 2), 164, y);
      doc.text(formatNumber(getOrderWeight(order), 0), 180, y);

      y += 5;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(80, 85, 95);
      doc.text(getAddress(order).slice(0, 105), 58, y);

      doc.setTextColor(0, 0, 0);
      y += 9;
    });

    y += 8;

    if (y > 238) {
      doc.addPage();
      y = 20;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Collection confirmation", 14, y);

    y += 11;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);

    doc.text("Collected by FDS:", 14, y);
    doc.line(50, y, 115, y);

    y += 10;
    doc.text("Signature:", 14, y);
    doc.line(50, y, 115, y);

    y += 10;
    doc.text("Date / time:", 14, y);
    doc.line(50, y, 115, y);

    doc.save(`FDS-Collection-Notice-${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  window.FdsNoticeGenerator = {
    generate
  };
})();