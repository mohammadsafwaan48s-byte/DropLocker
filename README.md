# 🚀 DropLocker

**DropLocker** is a lightweight, zero-cost, bi-directional cross-device file transfer hub designed to replace sluggish messaging apps for sharing photos, text snippets, and files between your phone and laptop.

[![Release](https://img.shields.io/github/v/release/mohammadsafwaan48s-byte/DropLocker?color=blue&label=Latest%20Release)](https://github.com/mohammadsafwaan48s-byte/DropLocker/releases/latest)
[![Windows](https://img.shields.io/badge/Windows-Download%20.exe-0078D6?logo=windows&logoColor=white)](https://github.com/mohammadsafwaan48s-byte/DropLocker/releases/latest)
[![Android](https://img.shields.io/badge/Android-Download%20.apk-3DDC84?logo=android&logoColor=white)](https://github.com/mohammadsafwaan48s-byte/DropLocker/releases/latest)

---

### 📥 Download Native Apps

Get DropLocker on your devices from the [Latest GitHub Release](https://github.com/mohammadsafwaan48s-byte/DropLocker/releases/latest):

| Platform | Download | Description |
| :--- | :--- | :--- |
| 🪟 **Windows** | [**DropLocker Setup 1.0.0.exe**](https://github.com/mohammadsafwaan48s-byte/DropLocker/releases/latest) | Windows Installer with Tray support & `Ctrl+Shift+V` hotkey |
| 🪟 **Windows (Portable)** | [**DropLocker 1.0.0.exe**](https://github.com/mohammadsafwaan48s-byte/DropLocker/releases/latest) | Standalone executable (no installation required) |
| 📱 **Android** | [**DropLocker.apk**](https://github.com/mohammadsafwaan48s-byte/DropLocker/releases/latest) | Native Android App with direct system Share Sheet support |

---

## ✨ Features

- 🔒 **Zero-Hassle Passkey Security:** Secured via a single secret passkey. Enter once, cached in your browser.
- ⚡ **Near-Instant Launch:** Vanilla JavaScript + custom "Obsidian Glass" styling with zero framework bloat.
- 📱 **Android Share Sheet Integration:** Share photos, videos, or documents directly from your Android gallery/apps to DropLocker.
- 💻 **Laptop Quick Sharing:**
  - **Global Drag-and-Drop:** Drop any file anywhere on the browser window to upload.
  - **Clipboard Paste (`Ctrl+V` / `Cmd+V`):** Paste copied screenshots or text snippets directly onto the page.
  - **One-Click Actions:** Download, copy image to clipboard, copy snippet, or delete.
  - **Instant Modal Preview:** Lightbox for images, audio/video player, and syntax-like reader for text notes.
- 🔄 **Real-Time Smart Polling:** Polls every 5 seconds when the window is focused, pauses when hidden to preserve battery and quota.
- 📌 **Pin to Protect:** Automatic 48-hour retention cleanup runs hourly via Cloudflare Cron Triggers. Click the **Pin** button on any file to keep it permanently.

---

## 📁 Project Structure

```
droplocker/
├── wrangler.toml                 # Cloudflare Worker, R2, D1, Assets & Cron config
├── package.json                  # Scripts & dependencies
├── tsconfig.json                 # TypeScript compiler configuration
├── migrations/
│   └── 0001_create_files.sql     # D1 SQLite schema
├── src/
│   └── worker.ts                 # Full REST API, streaming R2, D1 queries & Cron
├── public/                       # Static PWA assets (Zero latency edge delivery)
│   ├── index.html                # App shell with passkey gate & preview lightbox
│   ├── style.css                 # Obsidian Glass custom dark theme
│   ├── app.js                    # Reactive client (upload progress, sync, clipboard)
│   ├── manifest.json             # PWA Manifest + Web Share Target
│   ├── sw.js                     # Service Worker for offline shell caching
│   ├── icon.svg                  # Vector branding icon
│   ├── icon-192.png              # 192x192 PWA launcher icon
│   └── icon-512.png              # 512x512 PWA splash icon
└── scripts/
    └── generate-icons.js         # Pure Node.js PWA icon generator
```

---

## 🛠️ Step-by-Step Deployment Guide

Follow these simple steps to deploy your DropLocker instance to Cloudflare:

### 1. Authenticate with Cloudflare
If you haven't installed Wrangler or logged in yet:
```bash
npx wrangler login
```
*(A browser window will open asking you to authorize Wrangler).*

---

### 2. Create your R2 Storage Bucket
Run the following command to create the 10 GB free object storage bucket:
```bash
npx wrangler r2 bucket create droplocker-files
```

---

### 3. Create your D1 Database
Create the serverless SQLite metadata database:
```bash
npx wrangler d1 create droplocker-db
```
The output will display your `database_id`:
```text
[[d1_databases]]
binding = "DB"
database_name = "droplocker-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Open `wrangler.toml` and replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` with your actual `database_id`.

---

### 4. Apply the SQLite Database Schema
Initialize the `files` table and indexes in your remote D1 database:
```bash
npx wrangler d1 execute droplocker-db --remote --file=./migrations/0001_create_files.sql
```

*(For local testing, you can also run `npm run db:init:local`).*

---

### 5. Set Your Secret Passkey
Set your personal passkey (used to unlock the locker on both phone and laptop):
```bash
npx wrangler secret put PASSKEY
```
When prompted, type your desired passkey (e.g. `MyLockerPass789!`) and press Enter.

---

### 6. Deploy to Cloudflare
Deploy the worker, API, and static assets in one command:
```bash
npx wrangler deploy
```

Once deployment completes, Wrangler will output your live URL:
```text
Uploaded droplocker (x.xx sec)
Deployed droplocker to https://droplocker.<your-subdomain>.workers.dev
```

---

## 📱 How to Use on Android

1. Open your live DropLocker URL in **Chrome** on Android.
2. Enter your passkey to unlock.
3. Tap the browser menu (`⋮`) and select **"Add to Home screen"** or **"Install app"**.
4. **Share from Any App:**
   - Open your Android Gallery or Files app.
   - Select any photo, document, or video and tap **Share**.
   - Select **DropLocker** from the Android Share Sheet.
   - The file will be transferred and instantly synced to your locker!

---

## 💻 How to Use on Laptop / Desktop

1. Open your DropLocker URL in any desktop browser (Chrome, Edge, Brave, Safari, Firefox).
2. Enter your passkey.
3. **Sharing shortcuts:**
   - **Paste from Clipboard (`Ctrl+V` / `Cmd+V`):** Copy an image snippet or text note anywhere on your computer and press `Ctrl+V` on the page — it uploads instantly.
   - **Drag & Drop:** Drop one or multiple files directly onto the window.
   - **Quick Note:** Type in the quick note bar and press Enter to transfer a note or link.
   - **File Preview:** Click on any image thumbnail to open the full-screen lightbox or copy the image directly to your clipboard.

---

## 💻 Native Windows Desktop Application

You can launch and run the native desktop application immediately on your laptop:

```bash
npm run desktop
```

### Windows Native App Features:
- **System Tray Icon:** Minimizes near your Windows clock. Double-click to restore.
- **Global Hotkey (`Ctrl+Shift+V`):** Copy an image, file, or text anywhere in Windows, press `Ctrl+Shift+V`, and DropLocker instantly uploads it in the background!
- **Native Toast Notifications:** Displays Windows notifications when transfers complete.

---

## 📦 How to Get Your 2 Download Links (`.exe` and `.apk`)

To generate your **two ready-to-install download links** using GitHub Actions:

1. Initialize Git in this folder and push to your private/public GitHub repository:
   ```bash
   git init
   git add .
   git commit -m "DropLocker initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo-name>.git
   git push -u origin main
   ```

2. **Automated Cloud Build:**
   - Go to your repository on GitHub and click the **Actions** tab.
   - The workflow `Build DropLocker Apps (Windows .exe & Android .apk)` runs automatically.
   - GitHub compiles both applications on its free cloud runners.

3. **Download Links:**
   - Under the **Releases** section on the right side of your GitHub repository, you'll find:
     - 📥 **`DropLocker-Setup.exe`** (or portable executable for your laptop)
     - 📥 **`DropLocker.apk`** (installable directly on your Android phone)

---

## ⏰ Auto-Cleanup Retention Policy

- Any unpinned file older than **48 hours** is automatically purged by the hourly Cron Trigger (`0 * * * *`).
- To keep a file indefinitely, click the **Pin (📌)** icon on its card. Pinned files will never be auto-deleted.

---

## 💰 Free Tier Budget Confirmation

| Resource | Cloudflare Free Limit | Estimated Use (Personal) | Cost |
| :--- | :--- | :--- | :--- |
| **Worker Requests** | 100,000 / day | ~200 - 500 / day | **$0.00** |
| **R2 Storage** | 10 GB / month | ~0.5 - 2 GB (with 48h purge) | **$0.00** |
| **R2 Class A Ops (Uploads)** | 1,000,000 / month | ~500 / month | **$0.00** |
| **R2 Class B Ops (Downloads)**| 10,000,000 / month | ~3,000 / month | **$0.00** |
| **R2 Data Egress** | Unlimited (Zero egress fees) | Any | **$0.00** |
| **D1 Rows Read** | 5,000,000 / day | ~500 / day | **$0.00** |
| **D1 Rows Written** | 100,000 / day | ~50 / day | **$0.00** |
| **Total Monthly Cost** | — | — | **$0.00** |
