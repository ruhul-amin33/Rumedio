# 🛍️ BazarGhor — Daraz-style E-commerce (Free Hosting)

> **Version 1.0.0** · Frontend + API: **Vercel (free)** · Database: **freedb.tech MySQL (free)** · Code: **GitHub (free)**

এই README-টাই প্রজেক্টের **মাস্টার প্ল্যান**। নতুন কিছু যোগ করলে নিচের [Roadmap](#-roadmap-পরের-কাজ) ও [Changelog](#-changelog) আপডেট করে রাখুন — তাহলে ভবিষ্যতে যেকেউ (আপনি বা AI) এই ফাইল দেখেই বুঝতে পারবে কোথায় আছি, এরপর কী করতে হবে।

---

## 1. কী কী আছে (Features v1.0.0)

**কাস্টমার সাইড**
- হোমপেজ: hero slider, ক্যাটাগরি সাইডবার (মোবাইলে scroll-chips), Flash Sale (আজ রাত ১২টা পর্যন্ত countdown), "Just for you" grid + Load more
- সার্চ, ক্যাটাগরি পেজ, সর্ট (popular / newest / price / rating)
- প্রোডাক্ট ডিটেইল পেজ (ছাড় %, স্টক স্ট্যাটাস, quantity, Buy now / Add to cart, related products)
- কার্ট (localStorage-এ সেভ থাকে), ফ্রি ডেলিভারি ৳১,৫০০-এর উপরে, নাহলে ৳৬০
- Register / Login (JWT + bcrypt), Checkout (Cash on Delivery), My Orders

**অ্যাডমিন প্যানেল** (`/#/admin`)
- Overview (revenue, orders, pending, products, customers)
- Products: Add / Edit / Delete (ছবির লিংক বসানো যায়)
- Orders: স্ট্যাটাস বদলানো (pending → confirmed → shipped → delivered / cancelled)

**ডিজাইন ও রেসপন্সিভ**
- ফন্ট সাইজ `clamp()` দিয়ে fluid — ৩২০px ফোন থেকে বড় ডেস্কটপ পর্যন্ত নিজে নিজে ঠিক থাকে (`public/css/style.css`-এর `--fs-*` ভ্যারিয়েবল)
- বাংলা + ইংরেজি দুটোর জন্যই *Hind Siliguri* ফন্ট
- কীবোর্ড ফোকাস, `prefers-reduced-motion` সাপোর্ট আছে

**নিরাপত্তা (ব্যাকএন্ডে)**
- দাম সবসময় ডাটাবেস থেকে নেওয়া হয় (ব্রাউজারের দাম বিশ্বাস করা হয় না)
- অর্ডারে transaction + stock lock (ওভারসেল হয় না)
- Admin API শুধু admin role-এর জন্য

---

## 2. আর্কিটেকচার (কেন এটা "ঘুমায় না")

```
  Browser
     │
     ▼
 ┌──────────── Vercel (free) ─────────────┐
 │  public/        → static frontend (CDN) │
 │  api/index.js   → Express API (serverless)
 └───────────────────┬────────────────────┘
                     │ mysql2 (port 3306)
                     ▼
            freedb.tech  MySQL (free)
```

- Render-এর free plan-এ সার্ভার নিষ্ক্রিয় থাকলে ঘুমিয়ে যায়। এখানে API **serverless function** — চব্বিশ ঘণ্টা চালু সার্ভার নেই, তাই "ঘুমানো" বলে কিছু নেই। রিকোয়েস্ট আসলে সাথে সাথে চালু হয় (প্রথম রিকোয়েস্টে ~১ সেকেন্ড cold start হতে পারে)।
- সব `/api/*` রিকোয়েস্ট **একটাই function**-এ যায় (`api/index.js`), তাই Vercel Hobby-এর ১২ function লিমিটের ভেতরে থাকে।

### ⚠️ সৎ কথা: "সম্পূর্ণ আনলিমিটেড" বলে কিছু নেই
কোনো free সার্ভিসই সত্যিকারের unlimited না। তবে এই স্ট্যাক ছোট থেকে মাঝারি দোকানের জন্য যথেষ্ট:

| সার্ভিস | Free-তে কী পাচ্ছেন | মনে রাখুন |
|---|---|---|
| Vercel Hobby | বড় bandwidth ও function কোটা, ঘুমায় না | **Hobby plan শুধু ব্যক্তিগত/নন-কমার্শিয়াল ব্যবহারের জন্য** (Vercel-এর শর্ত)। আসল ব্যবসা শুরু করলে Pro ($20/মাস) বা অন্য হোস্টে সরান |
| freedb.tech | ফ্রি MySQL + phpMyAdmin | স্টোরেজ ও একসাথে connection সংখ্যা কম। ছবি ডাটাবেসে রাখা হয় না — শুধু লিংক রাখা হয় |
| GitHub | ফ্রি প্রাইভেট repo | — |

লিমিট ও শর্ত মাঝে মাঝে বদলায়, তাই সিদ্ধান্ত নেওয়ার আগে তাদের ওয়েবসাইটে একবার দেখে নিন।

---

## 3. A থেকে Z সেটআপ

### ধাপ A — freedb.tech-এ ডাটাবেস বানান
1. https://freedb.tech যান → Register করুন → লগইন।
2. **Create Database** দিন। এরপর dashboard-এ এই ৪টা তথ্য পাবেন (এগুলো কপি করে রাখুন):
   - **Host** (সাধারণত `sql.freedb.tech`), **Port** (`3306`)
   - **Database name**, **Username**, **Password**
3. ডাটাবেসে টেবিল বানানোর দুটো উপায় (যেকোনো একটা):
   - **উপায় ১ (সহজ, phpMyAdmin):** freedb.tech-এর phpMyAdmin-এ লগইন → আপনার database সিলেক্ট → **Import** ট্যাব → শুধু **`bazarghor_database.sql`** (zip-এর বাইরে দেওয়া একটাই ফাইল; একই জিনিস `database/schema.sql` + `seed.sql`) আপলোড করে Go। বার বার import করলেও ডুপ্লিকেট হবে না।
   - **উপায় ২ (কমান্ড):** নিচের ধাপ B শেষ করে `npm run setup-db` চালান।

> `seed.sql` শুধু ডেমো ক্যাটাগরি ও ২৪টা ডেমো প্রোডাক্ট দেয়। আসল দোকানে লাইভ যাওয়ার আগে অ্যাডমিন প্যানেল থেকে ডেমো প্রোডাক্ট মুছে নিজের প্রোডাক্ট বসান।

### ধাপ B — নিজের কম্পিউটারে চালিয়ে দেখুন
প্রথমে [Node.js](https://nodejs.org) (LTS, v18+) ইন্সটল করুন।

```bash
cd bazarghor
npm install
cp .env.example .env        # Windows: copy .env.example .env
```
`.env` ফাইল খুলে ধাপ A-র ডাটাবেস তথ্য বসান। `JWT_SECRET`-এ যেকোনো লম্বা এলোমেলো লেখা দিন, `ADMIN_EMAIL`-এ আপনার নিজের ইমেইল দিন।

```bash
npm run setup-db            # (উপায় ২ বেছে থাকলে) টেবিল + ডেমো ডাটা
npm run dev                 # http://localhost:3000
```

### ধাপ C — GitHub-এ আপলোড
1. https://github.com এ নতুন repo বানান (**Private** রাখতে পারেন)।
2. প্রজেক্ট ফোল্ডারে:
```bash
git init
git add .
git commit -m "BazarGhor v1.0.0"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/bazarghor.git
git push -u origin main
```
`.env` ফাইল `.gitignore`-এ আছে, তাই পাসওয়ার্ড GitHub-এ যাবে না। ✅

### ধাপ D — Vercel-এ ডেপ্লয়
1. https://vercel.com → **Continue with GitHub**।
2. **Add New → Project** → `bazarghor` repo **Import**।
3. **Framework Preset:** `Other` রাখুন। Build command / Output ফাঁকা রাখুন (`vercel.json` থেকে নিজেই পড়ে নেবে)।
4. **Environment Variables** খুলে এগুলো যোগ করুন:

| Name | Value |
|---|---|
| `DB_HOST` | freedb.tech-এর host |
| `DB_PORT` | `3306` |
| `DB_USER` | freedb.tech-এর username |
| `DB_PASSWORD` | freedb.tech-এর password |
| `DB_NAME` | freedb.tech-এর database name |
| `JWT_SECRET` | লম্বা এলোমেলো লেখা (৩২+ অক্ষর) |
| `ADMIN_EMAIL` | আপনার ইমেইল |

5. **Deploy** চাপুন। ১–২ মিনিটে `https://bazarghor-xxxx.vercel.app` লিংক পাবেন। 🎉

### ধাপ E — অ্যাডমিন হওয়া
সাইটে গিয়ে **Create account** থেকে `ADMIN_EMAIL`-এ দেওয়া ইমেইল দিয়েই রেজিস্টার করুন — আপনি নিজে থেকেই admin হবেন। এরপর উপরে নামে ক্লিক করলে `/#/admin` খুলবে। (অন্য কেউ ওই ইমেইল দিয়ে আগে রেজিস্টার করে ফেলার আগেই এটা করে ফেলুন।)

### ধাপ F — (ঐচ্ছিক) নিজের ডোমেইন
Vercel Project → **Settings → Domains** → আপনার ডোমেইন যোগ করে DNS-এ Vercel-এর দেখানো রেকর্ড বসান। ডোমেইন কিনতে টাকা লাগে (সাইট নিজে ফ্রি)।

### ধাপ G — প্রোডাক্টের ছবি
ডাটাবেসে ছবি রাখা হয় না, শুধু লিংক। ফ্রি উপায়: [Cloudinary](https://cloudinary.com) / [ImgBB](https://imgbb.com)-এ ছবি আপলোড করে "direct link" কপি করে অ্যাডমিনের *Image link* ঘরে বসান। ছবি না দিলে সুন্দর emoji টাইল দেখায়।

---

## 4. ফোল্ডার স্ট্রাকচার

```
bazarghor/
├─ api/index.js            Vercel entry (server/app.js কে কল করে)
├─ server/
│  ├─ app.js               সব API route (Express)
│  ├─ db.js                MySQL pool (freedb.tech-এর জন্য connectionLimit=1)
│  └─ local.js             লোকালে চালানোর জন্য
├─ public/                 ফ্রন্টএন্ড (static)
│  ├─ index.html
│  ├─ css/style.css        ডিজাইন টোকেন + fluid font
│  └─ js/app.js            পুরো SPA (hash routing)
├─ database/
│  ├─ schema.sql           টেবিল
│  ├─ seed.sql             ডেমো ডাটা
│  └─ migrations/          ভবিষ্যতের ডাটাবেস পরিবর্তন
├─ scripts/setup-db.js     npm run setup-db
├─ vercel.json             rewrite: /api/* → api/index.js
├─ .env.example
└─ README.md               ← এই ফাইল (প্ল্যান + গাইড)
```

## 5. API তালিকা

| Method | Path | কাজ | Auth |
|---|---|---|---|
| GET | `/api/health` | DB চালু কিনা | — |
| GET | `/api/categories` | ক্যাটাগরি | — |
| GET | `/api/products` | `?category=&q=&sort=&sale=1&page=&limit=` | — |
| GET | `/api/products/:id` | প্রোডাক্ট + related | — |
| POST | `/api/auth/register` `/login` | অ্যাকাউন্ট | — |
| GET | `/api/auth/me` | নিজের তথ্য | ✔ |
| POST | `/api/orders` | অর্ডার (COD) | ✔ |
| GET | `/api/orders/mine` | আমার অর্ডার | ✔ |
| GET | `/api/admin/stats` `/orders` | ড্যাশবোর্ড | Admin |
| PATCH | `/api/admin/orders/:id` | স্ট্যাটাস | Admin |
| POST/PUT/DELETE | `/api/admin/products[/:id]` | প্রোডাক্ট ম্যানেজ | Admin |

---

## 6. আপডেট করার নিয়ম (ভবিষ্যতের জন্য)

**কোড বদলালে:** ফাইল এডিট → `git add . && git commit -m "কী করলাম" && git push` → Vercel নিজে নিজেই নতুন ভার্সন ডেপ্লয় করে দেবে।

**ডাটাবেসে নতুন টেবিল/কলাম লাগলে:**
1. `database/migrations/002_নাম.sql` ফাইল বানিয়ে SQL লিখুন (যেমন `ALTER TABLE products ADD COLUMN brand VARCHAR(80);`)।
2. phpMyAdmin-এর SQL ট্যাবে সেটা **একবার** চালান।
3. নিচের Changelog-এ লিখে রাখুন কোন migration চালানো হয়েছে।

**নতুন ফিচার যোগ করার আগে:** Roadmap-এ থাকা কাজ থেকে বেছে নিন, শেষ হলে `[ ]` কে `[x]` করুন এবং Changelog-এ এন্ট্রি দিন।

**AI-কে দিয়ে আপডেট করাতে চাইলে:** এই README ও `server/app.js`, `public/js/app.js` ফাইল দিয়ে বলুন Roadmap-এর কোন আইটেম করাতে চান।

---

## 🗺 Roadmap (পরের কাজ)

**পরবর্তী (সবচেয়ে দরকারি)**
- [ ] bKash / Nagad পেমেন্ট (মার্চেন্ট অ্যাকাউন্ট লাগবে)
- [ ] ছবি আপলোড (Cloudinary free) — এখন শুধু লিংক বসানো যায়
- [ ] ক্যাটাগরি ম্যানেজ (অ্যাডমিন থেকে যোগ/মুছা)
- [ ] অর্ডার ট্র্যাকিং পেজ (ধাপে ধাপে স্ট্যাটাস)
- [ ] Forgot password (ইমেইল OTP)
- [ ] ডেলিভারি চার্জ: ঢাকার ভেতরে/বাইরে আলাদা

**তারপর**
- [ ] কুপন / ডিসকাউন্ট কোড
- [ ] রিভিউ ও রেটিং (ক্রেতা দেবে)
- [ ] Wishlist
- [ ] প্রোডাক্টে একাধিক ছবি, সাইজ/কালার ভ্যারিয়েন্ট
- [ ] SEO: আলাদা URL, sitemap, meta ট্যাগ (এখন hash routing)
- [ ] PWA (ফোনে ইনস্টল করা যায় এমন)
- [ ] বাংলা/English ভাষা বদল
- [ ] SMS/ইমেইল নোটিফিকেশন

**বড় পরিকল্পনা**
- [ ] মাল্টি-ভেন্ডর (একাধিক সেলার)
- [ ] ডাটাবেস বড় করা: TiDB Cloud / Aiven-এর মতো ফ্রি টিয়ারে সরানো (শুধু `DB_*` env বদলাতে হবে; SSL লাগলে `DB_SSL=true`)
- [ ] ব্যবসা বাড়লে Vercel Pro বা অন্য হোস্টে সরানো

---

## 🩺 সমস্যা হলে

| সমস্যা | কারণ ও সমাধান |
|---|---|
| সাইটে "Cannot reach the database" | Vercel-এর Environment Variables ভুল/অসম্পূর্ণ। ঠিক করে **Redeploy** দিন। freedb.tech dashboard-এ ডাটাবেস চালু আছে কিনা দেখুন |
| `ER_ACCESS_DENIED_ERROR` | username/password ভুল। freedb.tech থেকে আবার কপি করুন |
| `ER_USER_LIMIT_REACHED` / too many connections | freedb.tech-এ একসাথে connection সীমিত। কিছুক্ষণ পর আবার চেষ্টা করুন; ভিজিটর অনেক বাড়লে বড় DB-তে সরান |
| "Database tables are missing" | `schema.sql` ইম্পোর্ট করা হয়নি (ধাপ A-৩) |
| প্রোডাক্ট নেই | `seed.sql` ইম্পোর্ট করা হয়নি, অথবা অ্যাডমিন থেকে প্রোডাক্ট যোগ করুন |
| `/api/...` এ 404 | `vercel.json` ফাইল repo-র একদম root-এ আছে কিনা দেখুন |
| Admin হচ্ছে না | `ADMIN_EMAIL` আর রেজিস্টার করা ইমেইল হুবহু এক হতে হবে। আগে অন্য ইমেইলে রেজিস্টার করলে phpMyAdmin-এ `users` টেবিলে ওই সারির `role` কলাম `admin` করে দিন |
| ছবি দেখা যাচ্ছে না | লিংকটা সরাসরি ছবির লিংক (`.jpg/.png`) এবং `https://` দিয়ে শুরু কিনা দেখুন |

---

## 📜 Changelog

### v1.0.0 — প্রথম রিলিজ
- Storefront: হোম, ক্যাটাগরি, সার্চ, Flash Sale, প্রোডাক্ট ডিটেইল, কার্ট, চেকআউট (COD), অর্ডার লিস্ট
- Auth (JWT), Admin প্যানেল (products, orders, stats)
- ডাটাবেস: `schema.sql` (users, categories, products, orders, order_items) + `seed.sql`
- Migrations run হয়েছে: *(কিছু না — শুধু schema.sql v1)*
#   R u m e d i o  
 