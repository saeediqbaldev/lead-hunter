const express = require("express");
const db = require("../db");
const { buildCatchLogCsv, buildCatchLogPdf, buildNicheXlsx, buildExportFilename } = require("../export");

const router = express.Router();

function rowToLead(row) {
  return {
    ...row,
    needs: row.needs ? JSON.parse(row.needs) : [],
    socials: row.socials ? JSON.parse(row.socials) : {},
  };
}

const SORT_COLUMNS = {
  created_at: "l.created_at",
  name: "l.name COLLATE NOCASE",
  rating: "l.rating",
};

// Shared WHERE-clause builder so the paginated list and the "export current
// view" endpoints filter identically - same scope, same results, just one
// paginates and one doesn't. ALWAYS joins through to niches and filters by
// user_id, regardless of which other filters are given - "all records"
// means "all of MY records", never anyone else's.
function buildLeadsQuery(userId, query) {
  const { status, need, search, catchLogId, nicheId } = query;

  const sortBy = SORT_COLUMNS[query.sortBy] ? query.sortBy : "created_at";
  const sortDir = query.sortDir === "asc" ? "ASC" : query.sortDir === "desc" ? "DESC" : null;
  const defaultDir = { created_at: "DESC", rating: "DESC", name: "ASC" };
  const direction = sortDir || defaultDir[sortBy];

  let baseQuery = `
    FROM leads l
    JOIN catch_logs cl ON cl.id = l.catch_log_id
    JOIN niches n ON n.id = cl.niche_id
    WHERE n.user_id = ?
  `;
  const params = [userId];

  if (nicheId) {
    baseQuery += " AND cl.niche_id = ?";
    params.push(nicheId);
  }
  if (catchLogId) {
    baseQuery += " AND l.catch_log_id = ?";
    params.push(catchLogId);
  }
  if (status) {
    baseQuery += " AND l.status = ?";
    params.push(status);
  }
  if (need) {
    baseQuery += " AND l.needs LIKE ?";
    params.push(`%${need}%`);
  }
  if (search) {
    baseQuery += " AND (l.name LIKE ? OR l.address LIKE ?)";
    params.push(`%${search}%`, `%${search}%`);
  }

  return { baseQuery, params, sortBy, direction };
}

// GET /api/leads?status=&need=&search=&catchLogId=&nicheId=&page=&pageSize=&sortBy=&sortDir=
router.get("/", (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 50, 1), 200);
  const { baseQuery, params, sortBy, direction } = buildLeadsQuery(req.session.userId, req.query);

  const total = db.prepare(`SELECT COUNT(*) AS c ${baseQuery}`).get(...params).c;

  const offset = (page - 1) * pageSize;
  const rows = db
    .prepare(`SELECT l.*, cl.name AS city_name, n.name AS niche_name ${baseQuery} ORDER BY ${SORT_COLUMNS[sortBy]} ${direction} LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset);

  res.json({
    leads: rows.map(rowToLead),
    total,
    page,
    pageSize,
    totalPages: Math.max(Math.ceil(total / pageSize), 1),
  });
});

// GET /api/leads/export/:format(csv|xlsx|pdf) - same filters as above, no pagination
router.get("/export/:format", (req, res) => {
  const { format } = req.params;
  if (!["csv", "xlsx", "pdf"].includes(format)) {
    return res.status(400).json({ error: "format must be csv, xlsx, or pdf" });
  }

  const { baseQuery, params, sortBy, direction } = buildLeadsQuery(req.session.userId, req.query);
  const rows = db
    .prepare(`SELECT l.*, cl.name AS city_name, n.name AS niche_name ${baseQuery} ORDER BY ${SORT_COLUMNS[sortBy]} ${direction}`)
    .all(...params);
  const leads = rows.map(rowToLead);

  const title = "Current View";
  // Resolve actual names when the view is scoped to a specific niche/city,
  // so the filename is meaningful rather than always just "current-view".
  let filenameNiche = null;
  let filenameCity = null;
  if (req.query.catchLogId) {
    const row = db
      .prepare(
        `SELECT cl.name AS city_name, n.name AS niche_name FROM catch_logs cl
         JOIN niches n ON n.id = cl.niche_id
         WHERE cl.id = ? AND n.user_id = ?`
      )
      .get(req.query.catchLogId, req.session.userId);
    if (row) {
      filenameNiche = row.niche_name;
      filenameCity = row.city_name;
    }
  } else if (req.query.nicheId) {
    const row = db.prepare("SELECT name FROM niches WHERE id = ? AND user_id = ?").get(req.query.nicheId, req.session.userId);
    if (row) filenameNiche = row.name;
  }
  const filename = buildExportFilename({ niche: filenameNiche || "AllNiches", city: filenameCity });

  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
    return res.send(buildCatchLogCsv(title, leads));
  }

  if (format === "pdf") {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.pdf"`);
    const doc = buildCatchLogPdf(title, leads);
    return doc.pipe(res);
  }

  // xlsx
  buildNicheXlsx(title, [{ name: title, leads }]).then((buffer) => {
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
    res.send(buffer);
  });
});

// Verifies a lead belongs (via catch_log -> niche) to this user before any
// write - without this, PATCH/DELETE by numeric ID would let any logged-in
// user touch any other user's leads.
function getOwnedLead(userId, leadId) {
  return db
    .prepare(
      `SELECT l.* FROM leads l
       JOIN catch_logs cl ON cl.id = l.catch_log_id
       JOIN niches n ON n.id = cl.niche_id
       WHERE l.id = ? AND n.user_id = ?`
    )
    .get(leadId, userId);
}

// PATCH /api/leads/:id  { status?, notes? }
router.patch("/:id", (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body;

  const existing = getOwnedLead(req.session.userId, id);
  if (!existing) return res.status(404).json({ error: "Lead not found" });

  const newStatus = status !== undefined ? status : existing.status;
  const newNotes = notes !== undefined ? notes : existing.notes;

  db.prepare("UPDATE leads SET status = ?, notes = ? WHERE id = ?").run(newStatus, newNotes, id);
  res.json(rowToLead(db.prepare("SELECT * FROM leads WHERE id = ?").get(id)));
});

// DELETE /api/leads/:id
router.delete("/:id", (req, res) => {
  const existing = getOwnedLead(req.session.userId, req.params.id);
  if (!existing) return res.status(404).json({ error: "Lead not found" });

  db.prepare("DELETE FROM leads WHERE id = ?").run(req.params.id);
  res.json({ deleted: true });
});

module.exports = router;
