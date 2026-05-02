# @wimm/mobile

WIMM mobile client — Expo + React Native + TypeScript.

## Quick start

From the **repo root** (this is a pnpm workspace):

```bash
pnpm install                         # install all workspace deps
cp apps/mobile/.env.example apps/mobile/.env
pnpm --filter @wimm/mobile dev       # starts Metro
```

Then press `i` (iOS simulator) or `a` (Android emulator) in the Metro prompt.

For physical devices on your Wi-Fi, replace `localhost` in `.env` with your machine's LAN IP and use Expo Go (or a development build).

## Environment variables

| Var | Required | Default | Notes |
|---|---|---|---|
| `EXPO_PUBLIC_API_URL` | yes (prod) | `http://localhost:3000/api` | API base URL. **Must be `https://` in production builds** — `api-client.ts` throws at boot otherwise. |

EAS reads env vars from `eas.json` `build.<profile>.env`. Local dev reads from `.env`.

## Available scripts

| Script | What it does |
|---|---|
| `pnpm --filter @wimm/mobile dev` | `expo start` — Metro dev server |
| `pnpm --filter @wimm/mobile ios` | `expo start --ios` — open iOS simulator |
| `pnpm --filter @wimm/mobile android` | `expo start --android` — open Android emulator |
| `pnpm --filter @wimm/mobile lint` | `tsc --noEmit` — typecheck |

## Architecture

Reuses `@wimm/shared` types and the same REST API as `@wimm/desktop`. UI patterns intentionally diverge to fit native conventions (bottom tabs, FAB, swipe gestures, native pickers, native modals). See `CLAUDE.md` and `ARCHITECTURE.md` at the repo root.

Key folders under `src/`:

```
components/       UI primitives (Button, Field, Panel...) and feature blocks
context/          QuickAdd + Auth providers
i18n/             en + pt locales
lib/              api-client, secure token store, dates, formatters
navigation/       Root + Tabs + Settings stack navigators
screens/          One file per route
theme/            Design tokens ported from desktop's theme.css
```

## EAS Build (production / preview)

This project ships with an `eas.json` defining 3 profiles:

| Profile | API URL | Distribution | iOS target | Android target |
|---|---|---|---|---|
| `development` | `http://localhost:3000/api` | internal | simulator | APK |
| `preview` | VPS `https://wimm-api...` | internal | device | APK |
| `production` | VPS `https://wimm-api...` | store | TestFlight / Play Internal | AAB |

### One-time setup

```bash
npm i -g eas-cli                    # global CLI
eas login                           # Expo account
cd apps/mobile
eas init                            # creates a project on EAS, writes id back to app.json
```

### Build commands

```bash
# From apps/mobile/
eas build --profile preview --platform ios          # build .ipa for internal testing
eas build --profile preview --platform android      # build .apk
eas build --profile production --platform all       # store-ready build, both platforms
```

### Submit to stores

After a `production` build finishes:

```bash
eas submit --profile production --platform ios      # uploads to TestFlight
eas submit --profile production --platform android  # uploads to Play Internal
```

Requires:
- Apple Developer account ($99/year) for iOS
- Google Play Developer account ($25 one-time) for Android
- App Store Connect / Play Console listing created (name, bundle id, screenshots)

## Known gaps before public store release

- **App icon**: `assets/icon.png`, `adaptive-icon.png` and `splash-icon.png` are placeholders pointing at the in-app logo (337×225). Stores require **1024×1024 square** PNGs without alpha. Generate proper variants from `assets/images/wimm-logo-icon.png` before submitting.
- **App Store / Play Store metadata**: Description, screenshots, privacy policy URL, support URL — set up in App Store Connect and Play Console (not in this repo).
- **Code signing for iOS**: EAS handles automatically but requires Apple Developer account credentials configured in EAS.

## Workspace caveats

This repo uses **pnpm only**. Running `npm install` or `yarn` at the root will break the workspace symlinks and remove ~1700 packages. Recovery: `rm -rf node_modules apps/*/node_modules && pnpm install`.

`.npmrc` at the workspace root sets `node-linker=hoisted` because Metro doesn't follow pnpm's strict symlink layout for transitive deps (e.g. `@babel/runtime`).

## Tech stack

- Expo SDK 54 (React Native 0.81, React 19.1)
- TypeScript strict
- React Navigation 7 (Bottom Tabs + Native Stack)
- TanStack Query 5
- axios with single-flight refresh-token interceptor
- expo-secure-store for tokens (Keychain / Keystore)
- @react-native-async-storage/async-storage for non-sensitive prefs
- i18next (pt / en) with `expo-localization` device detection
- react-native-gifted-charts (donut + bar)
- react-native-gesture-handler (swipe-to-delete)
- lucide-react-native (icons)
