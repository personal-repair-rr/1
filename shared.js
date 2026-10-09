export const headers = ['id','createdAt','reporter','department','equipment','details','photo','phone','urgency','status','technician','adminNote','updatedAt','finishedAt','reserved'];
export const statusOptions = ['รอรับงาน','กำลังดำเนินการ','เสร็จสิ้น'];
export const urgencyOptions = ['ต่ำ','ปานกลาง','สูง'];
export function isSafeText(value, max) { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value); }
export function escapeSheetFormula(value) { const v = String(value); return /^[\s]*[=+\-@]/.test(v) ? `'${v}` : v; }
export function makePublic(ticket) { const { row, phone, adminNote, ...safe } = ticket; return safe; }
