const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");

const LEAD_COLUMNS = [
  "S/N",
  "Business Name",
  "City",
  "Address",
  "Maps Link",
  "Phone",
  "WhatsApp Link",
  "Website",
  "Social Links",
  "Rating",
  "Reviews",
  "Needs",
  "Status",
  "Notes",
];

function mapsLinkFor(lead) {
  if (lead.place_id) return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(lead.place_id)}`;
  if (lead.address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lead.address)}`;
  return "";
}

function whatsappLinkFor(phone) {
  if (!phone) return "";
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length < 8) return "";
  return `https://wa.me/${digits}`;
}

function needsText(lead) {
  const needs = Array.isArray(lead.needs) ? lead.needs : [];
  return needs.join("; ");
}

function socialLinksText(lead) {
  const socials = lead.socials || {};
  return Object.entries(socials)
    .map(([platform, url]) => `${platform}: ${url}`)
    .join(" | ");
}

function leadToRow(lead, index) {
  return [
    index + 1,
    lead.name,
    lead.city_name || "",
    lead.address || "",
    mapsLinkFor(lead),
    lead.phone || "",
    whatsappLinkFor(lead.phone),
    lead.website || "",
    socialLinksText(lead),
    lead.rating ?? "",
    lead.review_count ?? "",
    needsText(lead),
    lead.status,
    lead.notes || "",
  ];
}

function sanitizeFilename(name) {
  return String(name).replace(/[^a-z0-9\-_ ]/gi, "").trim().replace(/\s+/g, "_").slice(0, 80) || "export";
}

// ---------- CSV ----------
// Plain http(s) URLs in a CSV cell are auto-recognized as clickable links by
// Excel and Google Sheets when opened - that's the extent "clickable" can
// mean in a real CSV file (no embedded hyperlink objects exist in CSV itself).
function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
  return str;
}

function buildCsvSection(title, leads) {
  const lines = [];
  lines.push(csvEscape(title));
  lines.push(LEAD_COLUMNS.map(csvEscape).join(","));
  leads.forEach((lead, i) => lines.push(leadToRow(lead, i).map(csvEscape).join(",")));
  return lines.join("\n");
}

function buildCatchLogCsv(catchLogName, leads) {
  return buildCsvSection(catchLogName, leads) + "\n";
}

function buildNicheCsv(nicheName, catchLogsWithLeads) {
  const sections = catchLogsWithLeads.map((cl) => buildCsvSection(`Catch Log: ${cl.name}`, cl.leads));
  return `Niche: ${nicheName}\n\n` + sections.join("\n\n") + "\n";
}

// ---------- XLSX (true multi-sheet workbook - one real sheet per catch log) ----------
async function buildNicheXlsx(nicheName, catchLogsWithLeads) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Prospect";

  const usedNames = new Set();
  for (const cl of catchLogsWithLeads) {
    let base = cl.name.replace(/[:\\/?*\[\]]/g, "").slice(0, 28) || "Sheet";
    let sheetName = base;
    let n = 2;
    while (usedNames.has(sheetName)) {
      sheetName = `${base.slice(0, 25)} (${n})`;
      n++;
    }
    usedNames.add(sheetName);

    const sheet = workbook.addWorksheet(sheetName);
    sheet.addRow(LEAD_COLUMNS);
    sheet.getRow(1).font = { bold: true };

    cl.leads.forEach((lead, i) => {
      const values = leadToRow(lead, i);
      const row = sheet.addRow(values);
      const mapsUrl = values[4];
      const waUrl = values[6];
      const websiteUrl = values[7];
      if (mapsUrl) row.getCell(5).value = { text: "Open Map", hyperlink: mapsUrl };
      if (waUrl) row.getCell(7).value = { text: "Chat", hyperlink: waUrl };
      if (websiteUrl) row.getCell(8).value = { text: websiteUrl, hyperlink: websiteUrl };
    });

    sheet.columns.forEach((col) => {
      col.width = 22;
    });
  }

  if (workbook.worksheets.length === 0) {
    workbook.addWorksheet("No data").addRow(["This niche has no catch logs yet."]);
  }

  return workbook.xlsx.writeBuffer();
}

// ---------- PDF ----------
function writeLeadsSection(doc, title, leads) {
  doc.fontSize(16).fillColor("#111").text(title, { underline: true });
  doc.moveDown(0.4);

  if (leads.length === 0) {
    doc.fontSize(10).fillColor("#666").text("No records in this catch log.");
    doc.moveDown();
    return;
  }

  leads.forEach((lead, i) => {
    if (doc.y > 700) doc.addPage();

    const maps = mapsLinkFor(lead);
    doc
      .fontSize(11)
      .fillColor("#111")
      .text(`${i + 1}. ${lead.name}`, maps ? { link: maps, underline: true } : {});

    doc.fontSize(9).fillColor("#555");
    if (lead.address) doc.text(`    ${lead.address}`);

    if (lead.phone) {
      const wa = whatsappLinkFor(lead.phone);
      doc.text(`    Phone: ${lead.phone}${wa ? "  (WhatsApp click-to-chat below)" : ""}`);
      if (wa) doc.fillColor("#1a7a3c").text(`    Chat on WhatsApp`, { link: wa, underline: true });
      doc.fillColor("#555");
    }

    if (lead.website) {
      doc.fillColor("#1a4d8f").text(`    ${lead.website}`, { link: lead.website, underline: true });
      doc.fillColor("#555");
    }

    doc.text(
      `    Needs: ${needsText(lead) || "-"}    Rating: ${lead.rating ?? "n/a"}${
        lead.review_count ? ` (${lead.review_count})` : ""
      }    Status: ${lead.status}`
    );
    if (lead.notes) doc.text(`    Notes: ${lead.notes}`);

    doc.moveDown(0.6);
  });
}

function buildCatchLogPdf(catchLogName, leads) {
  const doc = new PDFDocument({ margin: 40 });
  writeLeadsSection(doc, catchLogName, leads);
  doc.end();
  return doc;
}

function buildNichePdf(nicheName, catchLogsWithLeads) {
  const doc = new PDFDocument({ margin: 40 });
  doc.fontSize(20).fillColor("#111").text(`Niche: ${nicheName}`, { underline: true });
  doc.moveDown();

  catchLogsWithLeads.forEach((cl, idx) => {
    if (idx > 0) doc.addPage();
    writeLeadsSection(doc, `Catch Log: ${cl.name}`, cl.leads);
  });

  doc.end();
  return doc;
}

module.exports = {
  buildCatchLogCsv,
  buildNicheCsv,
  buildNicheXlsx,
  buildCatchLogPdf,
  buildNichePdf,
  sanitizeFilename,
};
