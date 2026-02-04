# Subscription Filter & Billing Attempt Script

Dieses PHP-Script identifiziert fällige Subscription Contracts und erstellt Billing Attempts in Shopify.

## 🎯 Features

- **Dynamisches Laden von geskippten Contracts** aus Shopify
- **Test-Modus** für einzelne Contract IDs
- **Dry-Run-Modus** zum Testen ohne echte Billing Attempts
- **Identische Logik** wie das TypeScript-Script (`rebill.contracts.tsx`)
- **Rate Limiting** und Status-Polling
- **Intelligenter Cache** für schnellere Ausführungen
- **CLI-Argumente** für einfache Bedienung
- **Detailliertes Logging** für Debugging

---

## 🚀 Quick Start

### Test mit einer Contract ID (Dry Run)
```bash
php subscription-filter.php --test=29987733850
```

### Echter Billing mit Test-ID
```bash
php subscription-filter.php --push --test=29987733850
```

### Production - Alle Contracts verarbeiten ⚠️
```bash
php subscription-filter.php --push --no-cache
```

---

## 📋 CLI-Parameter

| Parameter | Wert | Beschreibung |
|-----------|------|--------------|
| `--push` | - | Aktiviert echte Billing Attempts (Standard: false) |
| `--push=false` | - | Explizit Dry Run |
| `--test=ID` | Contract ID | Filtert auf spezifische Contract ID(s) |
| `--date=DATUM` | YYYY-MM-DD | Target-Datum für Billing Cycle (Standard: **heutiges Datum**) |
| `--cache` | - | Cache aktivieren (Standard: aktiviert) |
| `--no-cache` | - | Cache deaktivieren, lädt frische Daten von Shopify |

---

## 📅 Target-Datum Konfiguration

Das Script verwendet standardmäßig das **heutige Datum** für die Filterung von fälligen Contracts.

### Prioritäts-Reihenfolge

1. **CLI-Argument:** `--date=YYYY-MM-DD` (höchste Priorität)
2. **Default:** Heutiges Datum (z.B. 2026-01-21)

### Verwendung

```bash
# Heutiges Datum verwenden (automatisch)
php subscription-filter.php --test=29987733850

# Spezifisches Datum verwenden
php subscription-filter.php --test=29987733850 --date=2026-02-21

# Zukünftiges Datum testen
php subscription-filter.php --date=2026-02-22
```

### Szenarien

**Täglicher Cron-Job:**
```bash
# Verwendet automatisch das aktuelle Datum
php subscription-filter.php --push --no-cache
```

**Zukünftiges Datum testen:**
```bash
# Teste Contracts, die am 21. Februar fällig sind
php subscription-filter.php --test=29987733850 --date=2026-02-21
```

**Verpasste Billing Attempts nachholen:**
```bash
# Verarbeite Contracts vom 15. Januar
php subscription-filter.php --push --date=2026-01-15 --no-cache
```

### Log-Output

Das Script zeigt das verwendete Target-Datum im Log:

```
=== Subscription Log gestartet: 2026-01-21 14:30:00 ===
Shop: scf26q-iq.myshopify.com
Today: 2026-01-21
Target Billing Date: 2026-01-21 (default)
Cache enabled: YES (default)
```

Bei explizitem `--date` Parameter:
```
Target Billing Date: 2026-02-21 (from --date parameter)
```

---

## 💾 Cache-Verwaltung

Das Script verwendet einen intelligenten Cache für schnellere Ausführungen.

### Was wird gecacht?

1. **Subscription Contracts** (`cache/contracts_YYYY-MM-DD.json`)
   - Alle gefilterten Contracts für den Tag
   - Spart ~30-60 Sekunden beim zweiten Lauf

2. **Billing Cycles** (`cache/billing_cycles_YYYY-MM-DD.json`)
   - Billing Cycle Daten für jeden Contract
   - Spart zusätzliche ~20-40 Sekunden

### Cache-Steuerung

```bash
# Mit Cache (Standard - schneller)
php subscription-filter.php --test=29987733850
# oder explizit:
php subscription-filter.php --cache --test=29987733850

# Ohne Cache (frische Daten von Shopify)
php subscription-filter.php --no-cache --test=29987733850

# Cache manuell löschen
rm -rf cache/*.json
```

### Performance-Vergleich

| Szenario | Mit Cache | Ohne Cache | Ersparnis |
|----------|-----------|------------|-----------|
| 1 Contract | ~2-3s | ~5-10s | ~60% |
| 10 Contracts | ~3-5s | ~15-30s | ~80% |
| 34 Contracts | ~5-8s | ~60-120s | ~90% |

### Wann Cache verwenden?

**✅ Cache verwenden (Standard):**
- Testing: Mehrere Test-Läufe mit verschiedenen IDs
- Debugging: Code-Änderungen testen ohne API-Last
- Development: Schnellere Iteration
- Wiederholte Ausführungen am selben Tag

**🔄 Cache deaktivieren (`--no-cache`):**
- Production: Immer frische Daten für echte Billing Attempts
- Erste Ausführung des Tages
- Nach Änderungen in Shopify
- Bei Zweifeln über Datenaktualität

---

### Parameter-Kombinationen

```bash
# Dry Run mit Test-ID (verwendet heutiges Datum)
php subscription-filter.php --test=29987733850

# Echter Billing mit Test-ID
php subscription-filter.php --push --test=29987733850

# Mehrere Test-IDs
php subscription-filter.php --push --test=29987733850,29988389210

# Alle Contracts (Dry Run, heutiges Datum)
php subscription-filter.php

# Alle Contracts (Echtes Billing) ⚠️
php subscription-filter.php --push --no-cache

# Mit spezifischem Datum
php subscription-filter.php --push --date=2026-01-22 --no-cache

# Zukünftiges Datum testen (mit Cache)
php subscription-filter.php --test=29987733850 --date=2026-02-21

# Ohne Cache (frische Daten)
php subscription-filter.php --no-cache --test=29987733850

# Production mit allen Features
php subscription-filter.php --push --no-cache --date=2026-01-21
```

---

## 💾 Cache-Verwaltung

Das Script verwendet einen intelligenten Cache für schnellere Ausführungen.

### Was wird gecacht?

1. **Subscription Contracts** (`cache/contracts_YYYY-MM-DD.json`)
   - Alle gefilterten Contracts für den Tag
   - Spart ~30-60 Sekunden beim zweiten Lauf

2. **Billing Cycles** (`cache/billing_cycles_YYYY-MM-DD.json`)
   - Billing Cycle Daten für jeden Contract
   - Spart zusätzliche ~20-40 Sekunden

### Cache-Befehle

```bash
# Mit Cache (Standard - schneller)
php subscription-filter.php --test=29987733850
# oder explizit:
php subscription-filter.php --cache --test=29987733850
# ⏱️ Erste Ausführung: ~5-10s
# ⚡ Zweite Ausführung: ~2-3s

# Ohne Cache (frische Daten)
php subscription-filter.php --no-cache --test=29987733850

# Cache manuell löschen
rm -rf cache/*.json
```

### Performance-Vergleich

| Szenario | Mit Cache | Ohne Cache | Ersparnis |
|----------|-----------|------------|-----------|
| 1 Contract | ~2-3s | ~5-10s | ~60% |
| 10 Contracts | ~3-5s | ~15-30s | ~80% |
| 34 Contracts | ~5-8s | ~60-120s | ~90% |

### Wann Cache verwenden?

**✅ Cache verwenden (Standard):**
- Testing: Mehrere Test-Läufe mit verschiedenen IDs
- Debugging: Code-Änderungen testen ohne API-Last
- Development: Schnellere Iteration
- Wiederholte Ausführungen am selben Tag

**🔄 Cache deaktivieren (`--no-cache`):**
- Production: Immer frische Daten für echte Billing Attempts
- Erste Ausführung des Tages
- Nach Änderungen in Shopify
- Bei Zweifeln über Datenaktualität

---

## 📁 Output-Dateien

### `logs/subscription_logs_*.txt`
Detailliertes Log mit:
- Filtering-Prozess
- Skip-Gründe (geskippte Billing Cycles)
- Billing Attempt Ergebnisse
- Fehler und Warnungen

### `logs/contract_ids_*.txt`
Kurze Liste der gefilterten Contract IDs mit:
- Customer Email
- Next Billing Date
- Cycle Info
- Last Order Info

### `cache/`
Cache-Dateien für Contracts und Billing Cycles:
- `contracts_YYYY-MM-DD.json`
- `billing_cycles_YYYY-MM-DD.json`

---

## 🔍 Logs anzeigen

```bash
# Neuestes Log
cat logs/subscription_logs_*.txt | tail -50

# Live-Monitoring
tail -f logs/subscription_logs_*.txt

# Nach Contract ID suchen
grep "29987733850" logs/subscription_logs_*.txt

# Contract IDs Log
cat logs/contract_ids_*.txt
```

---

## 📈 Beispiel-Output

### Dry Run Mode
```
=== BILLING ATTEMPT PHASE ===
Push to Shopify: NO (DRY RUN) 🔸
Total contracts to process: 17

⚠️ DRY RUN MODE - No billing attempts will be created

┌─────────────────────────────────────────────
│ Processing Contract: 30538793306
├─────────────────────────────────────────────
│ Customer: customer@example.com
│ Target Date: 2026-01-22 (via computedFromLastOrder)
│ Origin Time (UTC): 2026-01-22T00:00:00Z
│ 🔸 DRY RUN - Would create billing attempt
└─────────────────────────────────────────────

=== BILLING SUMMARY ===
Total contracts: 17
✅ Successful: 0
❌ Failed: 0
🔸 Skipped/Dry-run: 17
```

### Test Mode mit echter Billing
```
=== BILLING ATTEMPT PHASE ===
Push to Shopify: YES ✅
Test Mode: ONLY processing 1 contract(s)
Test IDs: 29987733850

┌─────────────────────────────────────────────
│ Processing Contract: 29987733850
├─────────────────────────────────────────────
│ Customer: customer@example.com
│ Target Date: 2026-01-22
│ Origin Time (UTC): 2026-01-22T00:00:00Z
├─────────────────────────────────────────────
  📤 Creating billing attempt...
  ✅ Billing attempt created successfully
     - Attempt ID: gid://shopify/SubscriptionBillingAttempt/123456
├─────────────────────────────────────────────
│ Waiting for billing completion...
  🔍 Checking status (attempt 1/15)...
  ✅ Billing attempt completed
     - Status: SUCCEEDED
     - Order: SUN18456
│ ✅ Billing completed successfully
│    Order created: SUN18456
└─────────────────────────────────────────────

=== BILLING SUMMARY ===
✅ Successful: 1
❌ Failed: 0
🔸 Skipped: 0
```

---

## ✅ Empfohlener Workflow

```bash
# 1. Dry Run für alle (zeigt alle fälligen Contracts)
php subscription-filter.php

# 2. Test mit einer ID (Dry Run)
php subscription-filter.php --test=29987733850

# 3. Test mit einer ID (ECHT - erstellt echten Billing Attempt)
php subscription-filter.php --push --test=29987733850

# 4. Logs prüfen
cat logs/subscription_logs_*.txt | tail -50

# 5. Bei Erfolg: Production (alle Contracts)
php subscription-filter.php --push --no-cache
```

---

## ⚠️ Wichtige Hinweise

### 1. Immer zuerst testen!
- Starte mit Dry Run
- Teste mit einer Contract ID
- Prüfe Logs vor Production

### 2. Geskippte Contracts werden automatisch ausgeschlossen
Das Script lädt den Billing Cycle für das Target-Datum und prüft das `skipped` Flag. Contracts mit `skipped: true` werden NICHT verarbeitet.

### 3. Idempotency Keys
Format: `rebill-php-{contractId}-{YYYY-MM-DD}`

Verhindert doppelte Billing Attempts für denselben Tag.

### 4. Rate Limiting
1 Sekunde Pause zwischen jedem Billing Attempt.

### 5. Status Polling
- Max. 15 Versuche
- 2 Sekunden Delay zwischen Versuchen
- Timeout nach ~30 Sekunden

### 6. IDs Format
- **Kurz:** `29987733850`
- **Lang:** `gid://shopify/SubscriptionContract/29987733850`
- **Mehrere:** `29987733850,29988389210` (komma-separiert)

---

## 🐛 Debugging

### Contract erscheint nicht in der Liste?

```bash
cat logs/subscription_logs_*.txt | grep "gid://shopify/SubscriptionContract/..."
```

**Mögliche Gründe:**
- Wrong interval (nicht 28 Tage)
- Outside window (nicht im Datumsbereich)
- Current cycle skipped (vom Kunden übersprungen)
- Missing nextBillingDate
- Falsches Datum verwendet (prüfe `Target Billing Date` im Log)

### Billing Attempt schlägt fehl?

```bash
cat logs/subscription_logs_*.txt | grep -A 20 "Creating billing attempt"
```

**Mögliche Fehler:**
- Payment method fehlt/ungültig
- Insufficient inventory
- Customer cancelled
- Contract paused/cancelled

### Cache-Probleme?

```bash
# Cache löschen und neu laden
rm -rf cache/*.json
php subscription-filter.php --no-cache --test=29987733850
```

---

## 🔄 Integration mit TypeScript-Job

Dieses PHP-Script verwendet dieselben GraphQL Queries und Mutations wie `rebill.contracts.tsx`:

- ✅ `subscriptionBillingAttemptCreate` Mutation
- ✅ `subscriptionBillingCycle` Query mit `selector: { date }`
- ✅ Idempotency Keys im gleichen Format
- ✅ Status Polling mit gleicher Logik
- ✅ Skip-Check für geskippte Billing Cycles

**Beide Scripts können parallel laufen** - die Idempotency Keys verhindern doppelte Billing Attempts.

---

## 🚀 Automatisierung (Cron)

```bash
# Täglich um 00:30 Uhr ausführen (verwendet automatisch heutiges Datum)
30 0 * * * cd /Users/abarmin/Sites/sun-sub2/php-job && php subscription-filter.php --push --no-cache >> logs/cron.log 2>&1

# Mit explizitem Datum
30 0 * * * cd /Users/abarmin/Sites/sun-sub2/php-job && php subscription-filter.php --push --no-cache --date=$(date +\%Y-\%m-\%d) >> logs/cron_$(date +\%Y-\%m-\%d).log 2>&1
```

---

## 📋 Checkliste vor Production

- [ ] Dry Run ausgeführt und Logs geprüft
- [ ] Test mit einer Contract ID erfolgreich
- [ ] Richtiges Datum wird verwendet (Log: `Target Billing Date`)
- [ ] Cache ist deaktiviert (`--no-cache`)
- [ ] Geskippte Contracts werden korrekt ausgeschlossen
- [ ] Idempotency Keys funktionieren (keine Duplikate)
- [ ] Rate Limiting ist aktiv
- [ ] Error Handling getestet
- [ ] Logs werden korrekt geschrieben
- [ ] Backup der wichtigen Daten vorhanden

---

## 🎯 Häufige Szenarien

### Tägliche Production-Ausführung
```bash
php subscription-filter.php --push --no-cache
```

## 🎯 Häufige Szenarien

### Tägliche Production-Ausführung
```bash
# Verwendet automatisch heutiges Datum
php subscription-filter.php --push --no-cache
```

### Mehrere Contracts testen
```bash
php subscription-filter.php --test=123,456,789
```

### Debugging mit Cache (schnell)
```bash
php subscription-filter.php --test=29987733850
# Mehrfach ausführen ohne API-Last
```

### Nach Shopify-Änderungen (Cache ignorieren)
```bash
php subscription-filter.php --no-cache --test=29987733850
```

### Bestimmtes Datum verarbeiten
```bash
php subscription-filter.php --push --date=2026-01-25 --no-cache
```

### Zukünftiges Datum testen
```bash
# Mit Cache für schnellere Tests
php subscription-filter.php --date=2026-02-21 --test=29987733850
```

---


**Entwickelt mit der gleichen Logik wie `rebill.contracts.tsx` ✨**

**Version:** 2.1 | **Letzte Aktualisierung:** 21. Januar 2026
