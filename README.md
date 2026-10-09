# โรงเรียนรัตนราษฎร์บำรุง — ระบบแจ้งซ่อมออนไลน์ (Node.js)

**ไม่ใช้ Google Apps Script** — ทำงานด้วย Node.js + Express เชื่อม Google Sheets API โดยตรง และเก็บรูปภาพไว้ในไดเรกทอรีของเซิร์ฟเวอร์

## ความสามารถ
- แจ้งซ่อมพร้อมข้อมูลผู้แจ้ง กลุ่มงาน พื้นที่ รายละเอียด เบอร์ติดต่อ ระดับเร่งด่วน และรูปภาพขนาดไม่เกิน 2 MB
- ผู้ใช้ดูรายการและสถานะอัปเดตล่าสุดได้โดยไม่ต้องเข้าสู่ระบบ (ไม่แสดงเบอร์โทรหรือหมายเหตุภายใน)
- Admin เข้าสู่ระบบ แสดงสถิติ ค้นหา กรอง แก้ไข มอบหมายช่าง เปลี่ยนสถานะ เพิ่มหมายเหตุ ลบ และพิมพ์รายงาน
- บันทึกและโหลดข้อมูลอัตโนมัติจาก Google Sheet แท็บ `Repairs`

## ติดตั้ง Google Sheets API
1. สร้างไฟล์ Google Sheets ใหม่และคัดลอก `SPREADSHEET_ID` จาก URL ที่อยู่ระหว่าง `/d/` กับ `/edit`.
2. เข้า https://console.cloud.google.com/ สร้างโปรเจ็กต์ เปิด **Google Sheets API**.
3. ไปที่ **IAM & Admin → Service Accounts** สร้าง Service Account และสร้าง **JSON key** (เก็บเป็นความลับ ห้ามอัปโหลดลง Git).
4. กลับไป Google Sheets กด **Share** และเพิ่มอีเมล service account พร้อมสิทธิ์ **Editor** เพื่อให้เว็บแอปเขียนชีตได้.
5. จากไฟล์ JSON คัดลอก `client_email` เป็น `GOOGLE_SERVICE_ACCOUNT_EMAIL` และ `private_key` เป็น `GOOGLE_PRIVATE_KEY` ใน `.env`. **อย่าใส่ service account key ในโค้ดหน้าเว็บหรือส่งต่อผู้ใช้.**

## ติดตั้งและเปิดเว็บ
```bash
cp .env.example .env
# กรอกข้อมูลและรหัสผ่านใน .env
npm install
npm start
```
เปิด http://localhost:3000 . ระบบจะสร้างแท็บ `Repairs` พร้อมคอลัมน์ที่กำหนดโดยอัตโนมัติในครั้งแรก (ให้ใช้ชีตใหม่โดยเฉพาะ).

หมายเหตุ: Node.js 20+; ตั้ง `JWT_SECRET` สุ่มอย่างน้อย 32 ตัวอักษร และ `ADMIN_PASSWORD` ยาวไม่ต่ำกว่า 12 ตัวอักษร. ต้องเปลี่ยนค่า `CHANGE_...` ก่อนเริ่ม.

## นำขึ้นออนไลน์ (Render / Railway / VPS)
- อัปโหลดโค้ดขึ้น GitHub **โดยไม่รวม `.env`, credential JSON และโฟลเดอร์ `uploads`**.
- สร้าง Node Web Service แล้วตั้ง `npm install` เป็น build command และ `npm start` เป็น start command.
- ใส่ Environment Variables จาก `.env` ผ่าน dashboard ของผู้ให้บริการ โดย `NODE_ENV=production` และ `PUBLIC_ORIGIN=https://โดเมนจริงของเว็บ` **ต้องตรงกันเป๊ะ**. บังคับใช้ HTTPS.
- เชื่อมต่อ Persistent Disk และตั้ง `UPLOAD_DIR` ไปยัง path ที่ติดตั้งดิสก์จริง มิฉะนั้นไฟล์ภาพอาจหายหลังรีสตาร์ต/ดีพลอยใหม่.
- ใช้ **1 instance** ของเว็บต่อ Google Sheet เพราะการอัปเดต/ลบเรียงลำดับคำสั่งภายในโปรเซสเดียว หากต้องการ scale หลาย instance ต้องเพิ่ม distributed locking หรือเปลี่ยนไปใช้ฐานข้อมูลจริง.
- **Google Sheets จะเก็บข้อความและพาธรูปภาพ** ส่วนตัวไฟล์รูปถูกเก็บในดิสก์ของเว็บเซิร์ฟเวอร์ ไม่ใช่ใน Sheets. รูปภาพเปิดด้วย URL `/photos/...`; ผู้มีลิงก์รูปอาจเปิดดูได้ จึงควรหลีกเลี่ยงภาพที่มีข้อมูลละเอียดอ่อน.
- ปัจจุบันระบบอนุญาตให้ผู้ชมหน้าเว็บอ่านชื่อผู้แจ้ง/กลุ่มงานและรายละเอียดงาน ตามแบบตัวอย่าง; ควรจำกัดผู้เข้าถึงเว็บในองค์กรหากข้อมูลเป็นข้อมูลภายใน.

## ข้อควรระวัง
- `ADMIN_PASSWORD` ใช้ยืนยันตัวตนจากเซิร์ฟเวอร์ ไม่ได้ถูกส่งไปยัง Google Sheets. เปลี่ยนรหัสผ่านต้องรีสตาร์ตเว็บ; ทุก token เดิมยังคงใช้ได้จนหมดอายุสูงสุด 8 ชั่วโมง เว้นแต่เปลี่ยน JWT_SECRET พร้อมกัน.
- ควรเปิดใช้ access control ของผู้ให้บริการโฮสต์, สำรองชีตและไฟล์แนบ และกำหนดสิทธิ์การแชร์ของ Sheet เป็นเฉพาะผู้เกี่ยวข้อง.
- ระบบไม่มีการป้องกันอัตโนมัติระดับองค์กรต่อสแปม/DoS, ไม่มี audit log และไม่มีระบบหลายบัญชี admin. แนะนำเพิ่มก่อนใช้งานในวงกว้าง.
- คำขอ POST/PATCH/DELETE ตรวจ Origin ที่ต้องตรง `PUBLIC_ORIGIN` และคุกกี้ HTTP-only, SameSite=Lax; API ถูกจำกัดจำนวนคำขอต่อ IP.

## ตรวจโค้ด
`npm run check` และ `npm test`

## API
- `POST /api/tickets` รับ multipart form-data รายการแจ้งซ่อม + `photo`
- `GET /api/tickets` อ่านรายการสำหรับหน้าเว็บทั่วไป
- `POST /api/admin/login`, `POST /api/admin/logout`, `GET /api/admin/me`
- `GET /api/admin/tickets`, `PATCH /api/admin/tickets/:id`, `DELETE /api/admin/tickets/:id`

**สถานะ:** รอรับงาน / กำลังดำเนินการ / เสร็จสิ้น
**ความเร่งด่วน:** ต่ำ / ปานกลาง / สูง
