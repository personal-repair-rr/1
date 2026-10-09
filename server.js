import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { google } from 'googleapis';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSafeText, escapeSheetFormula, makePublic, statusOptions, urgencyOptions, headers } from './shared.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const production = process.env.NODE_ENV === 'production';
const secret = process.env.JWT_SECRET || '';
const adminPassword = process.env.ADMIN_PASSWORD || '';
const adminUsername = process.env.ADMIN_USERNAME || 'admin';
const sheetId = process.env.GOOGLE_SHEET_ID;
const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(dirname, 'uploads'));
const origin = (process.env.PUBLIC_ORIGIN || `http://localhost:${port}`).replace(/\/$/, '');
if (!sheetId || !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY || secret.length < 32 || adminPassword.length < 12 || adminPassword.startsWith('CHANGE_')) {
  console.error('Configuration missing. Check .env and README.md.');
  process.exit(1);
}
fs.mkdirSync(uploadDir, { recursive: true });
const hashedPassword = bcrypt.hashSync(adminPassword, 12);
const auth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });
const range = (a1) => `'Repairs'!${a1}`;
let writeQueue = Promise.resolve();
function exclusive(fn) { const done = writeQueue.then(fn); writeQueue = done.catch(() => {}); return done; }
async function ensureSheet() {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: 'sheets.properties.title' });
  if (!meta.data.sheets?.some(s => s.properties.title === 'Repairs')) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: sheetId, requestBody: { requests: [{ addSheet: { properties: { title: 'Repairs' } } }] } });
  }
  const top = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: range('A1:O1') });
  if (!top.data.values?.[0]?.length) await sheets.spreadsheets.values.update({ spreadsheetId: sheetId, range: range('A1:O1'), valueInputOption: 'RAW', requestBody: { values: [headers] } });
  else if (top.data.values[0].join('|') !== headers.join('|')) throw new Error('Repairs headers do not match expected schema. See README.');
}
async function rows() {
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: range('A2:O') });
  return (r.data.values || []).map((a, i) => ({ row: i + 2, ...Object.fromEntries(headers.map((h, j) => [h, a[j] ?? ''])) })).filter(r => r.id);
}
function validString(v, max = 500) { return isSafeText(v, max); }
function normalizeTicket(body, existing = {}) {
  const ret = {};
  for (const [key, max] of [['reporter', 100], ['department', 100], ['equipment', 150], ['details', 2000], ['phone', 30]]) {
    const value = body[key] === undefined ? existing[key] : body[key];
    if (!validString(value, max)) throw Object.assign(new Error(`ข้อมูล ${key} ไม่ถูกต้อง`), { status: 400 });
    ret[key] = String(value).trim();
  }
  if (!/^[0-9+()\s-]{8,30}$/.test(ret.phone)) throw Object.assign(new Error('เบอร์โทรศัพท์ไม่ถูกต้อง'), { status: 400 });
  ret.urgency = body.urgency === undefined ? existing.urgency : body.urgency;
  if (!urgencyOptions.includes(ret.urgency)) throw Object.assign(new Error('ระดับความเร่งด่วนไม่ถูกต้อง'), { status: 400 });
  return ret;
}
const app = express();
if (production) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'], objectSrc: ["'none'"], upgradeInsecureRequests: production ? [] : null } } }));
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '150kb' }));
app.use(express.static(path.join(dirname, 'public')));
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 80, standardHeaders: 'draft-7', legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false });
const submitLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 15, standardHeaders: 'draft-7', legacyHeaders: false });
app.use('/api', limiter);
function requireOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const supplied = req.headers.origin;
  if (!supplied || supplied !== origin) return res.status(403).json({ error: 'Origin not allowed. Check PUBLIC_ORIGIN.' });
  next();
}
app.use('/api', requireOrigin);
function admin(req, res, next) {
  try {
    const token = req.cookies.rrb_admin;
    if (!token) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบผู้ดูแล' });
    const data = jwt.verify(token, secret, { issuer: 'rrb-repair', audience: 'rrb-admin', algorithms: ['HS256'] });
    if (data.sub !== adminUsername) throw new Error('invalid account');
    next();
  } catch { res.status(401).json({ error: 'กรุณาเข้าสู่ระบบใหม่' }); }
}
app.post('/api/admin/login', loginLimiter, async (req, res) => {
  const match = req.body?.username === adminUsername && await bcrypt.compare(String(req.body?.password || ''), hashedPassword);
  if (!match) return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
  res.cookie('rrb_admin', jwt.sign({ sub: adminUsername }, secret, { expiresIn: '8h', issuer: 'rrb-repair', audience: 'rrb-admin' }), { httpOnly: true, secure: production, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000, path: '/' });
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => { res.clearCookie('rrb_admin', { path: '/' }); res.json({ ok: true }); });
app.get('/api/admin/me', admin, (req, res) => res.json({ ok: true }));
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' })[file.mimetype] || '.bin'}`)
});
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024, files: 1 }, fileFilter: (_req, f, cb) => cb(null, ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(f.mimetype)) });
async function verifiedImage(file) {
  if (!file) return '';
  const fd = fs.openSync(file.path, 'r');
  const bytes = Buffer.alloc(16);
  try { fs.readSync(fd, bytes, 0, 16, 0); } finally { fs.closeSync(fd); }
  const jpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  const gif = bytes.subarray(0, 6).toString('ascii').match(/^GIF8[79]a$/);
  const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!(jpg || png || gif || webp)) { fs.unlinkSync(file.path); throw Object.assign(new Error('ไฟล์ไม่ใช่รูปภาพที่รองรับ'), { status: 400 }); }
  return `/photos/${path.basename(file.path)}`;
}
app.use('/photos', express.static(uploadDir, { index: false, maxAge: '1d', immutable: false, setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff') }));
app.post('/api/tickets', submitLimiter, upload.single('photo'), async (req, res, next) => {
  let photo = '';
  try {
    const data = normalizeTicket(req.body);
    photo = await verifiedImage(req.file);
    const now = new Date().toISOString();
    const id = `RR-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const ticket = { id, createdAt: now, ...data, photo, status: 'รอรับงาน', technician: '', adminNote: '', updatedAt: now, finishedAt: '' };
    await exclusive(() => sheets.spreadsheets.values.append({ spreadsheetId: sheetId, range: range('A:O'), valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: [headers.map(h => escapeSheetFormula(ticket[h] ?? ''))] } }));
    res.status(201).json({ ok: true, id });
  } catch (err) { if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); next(err); }
});
app.get('/api/tickets', async (req, res, next) => {
  try {
    const data = (await rows()).reverse().map(makePublic);
    res.set('Cache-Control', 'no-store');
    res.json({ tickets: data });
  } catch (e) { next(e); }
});
app.get('/api/admin/tickets', admin, async (req, res, next) => {
  try { res.set('Cache-Control', 'no-store'); res.json({ tickets: (await rows()).reverse().map(({ row, ...t }) => t) }); } catch (e) { next(e); }
});
app.patch('/api/admin/tickets/:id', admin, async (req, res, next) => {
  try {
    const result = await exclusive(async () => {
      const all = await rows();
      const previous = all.find(r => r.id === req.params.id);
      if (!previous) throw Object.assign(new Error('ไม่พบรายการแจ้งซ่อม'), { status: 404 });
      const data = normalizeTicket(req.body, previous);
      const status = req.body.status ?? previous.status;
      if (!statusOptions.includes(status)) throw Object.assign(new Error('สถานะไม่ถูกต้อง'), { status: 400 });
      const technician = req.body.technician ?? previous.technician;
      const adminNote = req.body.adminNote ?? previous.adminNote;
      if (typeof technician !== 'string' || technician.length > 100 || typeof adminNote !== 'string' || adminNote.length > 1000) throw Object.assign(new Error('ชื่อช่าง/หมายเหตุยาวเกินไป'), { status: 400 });
      const updatedAt = new Date().toISOString();
      const ticket = { ...previous, ...data, status, technician, adminNote, updatedAt, finishedAt: status === 'เสร็จสิ้น' ? (previous.finishedAt || updatedAt) : '' };
      await sheets.spreadsheets.values.update({ spreadsheetId: sheetId, range: range(`A${previous.row}:O${previous.row}`), valueInputOption: 'RAW', requestBody: { values: [headers.map(h => escapeSheetFormula(ticket[h] ?? ''))] } });
      const { row, ...withoutRow } = ticket;
      return withoutRow;
    });
    res.json({ ok: true, ticket: result });
  } catch (err) { next(err); }
});
app.delete('/api/admin/tickets/:id', admin, async (req, res, next) => {
  try {
    await exclusive(async () => {
      const all = await rows();
      const item = all.find(r => r.id === req.params.id);
      if (!item) throw Object.assign(new Error('ไม่พบรายการแจ้งซ่อม'), { status: 404 });
      const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: 'sheets.properties(sheetId,title)' });
      const sheet = meta.data.sheets.find(s => s.properties.title === 'Repairs');
      await sheets.spreadsheets.batchUpdate({ spreadsheetId: sheetId, requestBody: { requests: [{ deleteDimension: { range: { sheetId: sheet.properties.sheetId, dimension: 'ROWS', startIndex: item.row - 1, endIndex: item.row } } }] } });
      // Uploaded image is retained in storage to avoid accidental loss; clean up separately when needed.
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'รูปภาพต้องไม่เกิน 2 MB' : error.message });
  console.error(error);
  res.status(error.status || 500).json({ error: error.status ? error.message : 'ระบบมีปัญหา โปรดลองอีกครั้ง' });
});
try { await ensureSheet(); app.listen(port, () => console.log(`Repair app ready: http://localhost:${port}`)); }
catch (error) { console.error('Could not initialize Google Sheets:', error.message); process.exit(1); }
