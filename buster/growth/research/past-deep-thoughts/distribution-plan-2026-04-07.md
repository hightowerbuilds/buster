# Buster IDE — Distribution Plan

**Date:** 2026-04-07
**Current state:** Builds locally on macOS x86_64, 10 MB DMG, unsigned

---

## 1. Apple Developer Program Enrollment

**What:** Enroll in the Apple Developer Program to get code signing and notarization certificates.

**Why:** Without signing, macOS Gatekeeper blocks the app. Users see "Buster can't be opened because Apple cannot check it for malicious software." Power users can bypass this in System Settings > Privacy & Security, but most people won't.

**Steps:**
1. Go to https://developer.apple.com/programs/
2. Sign in with your Apple ID
3. Enroll as an individual ($99/year)
4. Wait for approval (usually 24-48 hours)
5. Once approved, create a **Developer ID Application** certificate in Xcode or the developer portal
6. Also create a **Developer ID Installer** certificate (needed for signing the DMG)
7. Generate an app-specific password at https://appleid.apple.com for notarization

**What you'll have after this:**
- A signing identity like `Developer ID Application: Luke Hightower (XXXXXXXXXX)`
- An installer signing identity
- An app-specific password for the `notarytool` CLI

---

## 2. Configure Tauri for Code Signing + Notarization

**What:** Tell Tauri to sign and notarize the app during builds.

**Steps:**

Set these environment variables (locally or in CI):

```bash
# Code signing identity (from step 1)
export APPLE_SIGNING_IDENTITY="Developer ID Application: Luke Hightower (XXXXXXXXXX)"

# Notarization credentials
export APPLE_ID="your@email.com"
export APPLE_PASSWORD="app-specific-password-from-step-1"
export APPLE_TEAM_ID="XXXXXXXXXX"
```

Tauri v2 automatically signs and notarizes when these env vars are present during `tauri build`. No config file changes needed.

**Verify locally:**
```bash
APPLE_SIGNING_IDENTITY="..." APPLE_ID="..." APPLE_PASSWORD="..." APPLE_TEAM_ID="..." bun run tauri build
```

The output should show "Signing" and "Notarizing" steps. The resulting DMG will open without Gatekeeper warnings on any Mac.

---

## 3. Set Up GitHub Actions CI for Cross-Platform Builds

**What:** Automate builds for macOS (x64 + ARM), Windows, and Linux on every version tag.

**Steps:**

1. Create `.github/workflows/release.yml` in the repo
2. The workflow triggers on version tags (e.g., `v0.1.0`)
3. It builds on three runners: `macos-latest` (ARM), `macos-13` (x64), `windows-latest`, `ubuntu-22.04`
4. Each runner installs dependencies, runs `tauri build`, and uploads artifacts
5. A final step creates a GitHub Release with all artifacts attached

**Secrets to add in GitHub repo settings (Settings > Secrets > Actions):**

| Secret | Value |
|--------|-------|
| `APPLE_CERTIFICATE` | Base64-encoded .p12 certificate |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the .p12 |
| `APPLE_SIGNING_IDENTITY` | Full identity string |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | 10-character team ID |

**What users get per platform:**

| Platform | Artifact | Format |
|----------|----------|--------|
| macOS ARM (M1/M2/M3/M4) | `Buster_x.x.x_aarch64.dmg` | DMG with drag-to-install |
| macOS Intel | `Buster_x.x.x_x64.dmg` | DMG with drag-to-install |
| Windows | `Buster_x.x.x_x64-setup.exe` | NSIS installer |
| Windows | `Buster_x.x.x_x64_en-US.msi` | MSI installer |
| Linux (Debian/Ubuntu) | `buster_x.x.x_amd64.deb` | apt-installable package |
| Linux (Fedora/Arch) | `buster_x.x.x_amd64.AppImage` | Portable, no install needed |

---

## 4. Add Auto-Update Support

**What:** Let the app check for updates and prompt the user to install them without redownloading from the website.

**Steps:**

1. Add the Tauri updater plugin:
   ```bash
   cargo add tauri-plugin-updater --manifest-path src-tauri/Cargo.toml
   bun add @tauri-apps/plugin-updater
   ```

2. Register the plugin in `src-tauri/src/lib.rs`:
   ```rust
   .plugin(tauri_plugin_updater::init())
   ```

3. Add updater config to `src-tauri/tauri.conf.json`:
   ```json
   {
     "plugins": {
       "updater": {
         "endpoints": [
           "https://releases.buster.dev/update/{{target}}/{{arch}}/{{current_version}}"
         ],
         "pubkey": "YOUR_PUBLIC_KEY_HERE"
       }
     }
   }
   ```

4. Generate a keypair for signing updates:
   ```bash
   bun run tauri signer generate -w ~/.tauri/buster.key
   ```
   This outputs a public key (put in tauri.conf.json) and a private key (put in CI secrets as `TAURI_SIGNING_PRIVATE_KEY`).

5. The update endpoint can be:
   - **GitHub Releases** (simplest) — Tauri has a built-in GitHub updater endpoint format
   - **Static JSON on your server** — A JSON file that points to the latest version and download URLs
   - **CrabNebula Cloud** — Managed hosting for Tauri updates (free tier available)

6. Add update check to the frontend (e.g., on app launch or in settings):
   ```typescript
   import { check } from "@tauri-apps/plugin-updater";
   const update = await check();
   if (update) {
     await update.downloadAndInstall();
   }
   ```

---

## 5. Website Download Page

**What:** A page on your website where people can download Buster.

**Options (simplest to most involved):**

### Option A: Link to GitHub Releases (simplest)
Just link to `https://github.com/hightowerbuilds/buster/releases/latest`. GitHub handles hosting, bandwidth, and shows all platform downloads.

### Option B: Smart download button
Detect the visitor's OS via user-agent and show the right download link:
- macOS visitor sees the DMG link
- Windows visitor sees the EXE link
- Linux visitor sees the AppImage link

All links still point to GitHub Releases.

### Option C: Self-hosted
Host the artifacts on your own server or CDN (Cloudflare R2, S3, etc.). Full control over the download experience. More work, costs money for bandwidth.

**Recommended starting point:** Option B — smart download button linking to GitHub Releases.

---

## 6. Version Tagging and Release Flow

**How to ship a new version:**

1. Update version in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`
2. Commit: `git commit -m "Bump version to 0.2.0"`
3. Tag: `git tag v0.2.0`
4. Push: `git push origin main --tags`
5. CI builds all platforms, signs, notarizes, creates GitHub Release
6. Auto-updater picks up the new version for existing users
7. Website download page automatically points to the latest release

---

## 7. Optional: Windows Code Signing

**What:** Sign the Windows installer so SmartScreen doesn't flag it as untrusted.

**Options:**
- **EV code signing certificate** (~$300-500/year from DigiCert, Sectigo, etc.) — instant SmartScreen trust
- **Standard code signing certificate** (~$70-200/year) — builds trust over time as downloads accumulate
- **Skip it initially** — Windows will show a "Windows protected your PC" warning. Users click "More info" > "Run anyway." Not ideal but functional for early adopters.

---

## Execution Order

| Priority | Step | Cost | Time |
|----------|------|------|------|
| 1 | Apple Developer enrollment | $99/year | 1-2 days (approval) |
| 2 | Configure signing locally | Free | 1 hour |
| 3 | GitHub Actions CI workflow | Free | 2-3 hours |
| 4 | Website download page | Free | 1-2 hours |
| 5 | Auto-updater plugin | Free | 2-3 hours |
| 6 | Windows code signing | $70-500/year | 1-2 days (certificate issuance) |

Steps 1-4 get you to "anyone can download and install Buster." Steps 5-6 polish the experience.
