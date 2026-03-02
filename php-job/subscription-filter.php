<?php
ini_set('max_execution_time', -1);

$shop       = 'himanshu-self.myshopify.com';
 
$apiVersion  = '2026-01';

$endpoint = "https://{$shop}/admin/api/{$apiVersion}/graphql.json";

// ===== CACHE CONFIGURATION =====
// Parse CLI arguments für Cache-Steuerung
$cliArgs = parseCliArguments($argv ?? []);

// Cache-Einstellung: CLI-Parameter hat Vorrang über Default
if ($cliArgs['cache'] !== null) {
    // --cache oder --no-cache wurde explizit gesetzt
    $cacheEnabled = $cliArgs['cache'];
} else {
    // Default: Cache ist aktiviert
    $cacheEnabled = true;
}

$cacheDir = __DIR__ . '/cache';
$cacheFile = $cacheDir . '/contracts_' . date('Y-m-d') . '.json';
$cacheBillingCyclesFile = $cacheDir . '/billing_cycles_' . date('Y-m-d') . '.json';
$shopTimezoneName = getenv('SHOP_TIMEZONE') ?: 'Europe/Berlin';
try {
    $shopTimezone = new DateTimeZone($shopTimezoneName);
} catch (Exception $e) {
    $shopTimezone = new DateTimeZone('UTC');
}
$utcTimezone = new DateTimeZone('UTC');

// Log-Verzeichnis erstellen falls nicht vorhanden
$logsDir = __DIR__ . '/logs';
if (!is_dir($logsDir)) {
    mkdir($logsDir, 0755, true);
}

// Log-Datei definieren
$logFile = $logsDir . '/subscription_logs_' . date('Y-m-d_H-i-s') . '.txt';
$contractIdsLogFile = $logsDir . '/contract_ids_' . date('Y-m-d_H-i-s') . '.txt';

// Hilfsfunktion für Logging
function logMessage($message, $logFile) {
    echo $message;
    file_put_contents($logFile, strip_tags($message), FILE_APPEND);
}

// CLI-Argument-Parser
function parseCliArguments(array $argv): array {
    $args = array_slice($argv, 1);
    $result = [
        'cache' => null,  // null = nicht gesetzt, true = --cache, false = --no-cache
        'date' => null,
        'test' => null,   // Test Contract IDs (komma-separiert)
        'push' => null,   // null = nicht gesetzt, true = --push, false = --push=false
    ];

    foreach ($args as $i => $arg) {
        if (!$arg) continue;

        // --cache (Cache aktivieren)
        if ($arg === '--cache') {
            $result['cache'] = true;
        }

        // --no-cache (Cache deaktivieren)
        if ($arg === '--no-cache') {
            $result['cache'] = false;
        }

        // --date=YYYY-MM-DD Format
        if (strpos($arg, '--date=') === 0) {
            $result['date'] = substr($arg, 7);
        }

        // --date YYYY-MM-DD Format (zwei separate Argumente)
        if ($arg === '--date' && isset($args[$i + 1])) {
            $result['date'] = $args[$i + 1];
        }

        // --test=IDs Format
        if (strpos($arg, '--test=') === 0) {
            $result['test'] = substr($arg, 7);
        }

        // --push Format
        if ($arg === '--push') {
            $result['push'] = true;
        }

        // --push=false Format
        if ($arg === '--push=false') {
            $result['push'] = false;
        }
    }

    return $result;
}

function toLocalDateString(?string $dateTime, DateTimeZone $targetTz): ?string {
    if (empty($dateTime)) return null;
    try {
        $dt = new DateTimeImmutable($dateTime);
    } catch (Exception $e) {
        return null;
    }
    return $dt->setTimezone($targetTz)->format('Y-m-d');
}

function parseTargetDateFromArgs(array $argv): ?string {
    $cliArgs = parseCliArguments($argv);
    return $cliArgs['date'];
}

function resolveTargetNextBillingDate(string $today, array $argv): string {
    // Prüfe ob --date Parameter gesetzt ist
    $cliDate = isset($argv) ? parseTargetDateFromArgs($argv) : null;
    if ($cliDate) {
        return $cliDate;
    }

    // Default: Heutiges Datum
    return $today;
}

// Calculate date range: 28 days ago (with 2-day tolerance window)
$today = date('Y-m-d');
$billingIntervalDays = 28;
$currentCycleMatchToleranceDays = 1;
$targetNextBillingDate = resolveTargetNextBillingDate($today, $argv ?? []);
$targetDateObj = DateTimeImmutable::createFromFormat('Y-m-d', $targetNextBillingDate, $shopTimezone) ?: new DateTimeImmutable($today, $shopTimezone);
$windowStartDateTime = $targetDateObj->setTime(0, 0, 0);
$windowEndDateTime = $windowStartDateTime->modify('+1 day');
$targetDateString = $windowStartDateTime->format('Y-m-d');
$nextBillingWindowStart = $targetDateString;
$nextBillingWindowEnd = $targetDateString;
$billingCycleSelectorStart = $windowStartDateTime
    ->setTimezone($utcTimezone)
    ->modify("-{$billingIntervalDays} days")
     ->format(DateTimeInterface::ATOM);
$billingCycleSelectorEnd = $windowEndDateTime
     ->setTimezone($utcTimezone)
    ->modify("+{$currentCycleMatchToleranceDays} days")
     ->format(DateTimeInterface::ATOM);
$searchWindowPastDays = 1;
$searchWindowFutureDays = 2;
$searchWindowStart = $windowStartDateTime->modify("-{$searchWindowPastDays} days")->format('Y-m-d');
$searchWindowEnd = $windowEndDateTime->modify("+{$searchWindowFutureDays} days")->format('Y-m-d');
$searchQuery = "status:ACTIVE AND next_billing_date:>={$searchWindowStart} AND next_billing_date<={$searchWindowEnd}";

// Logs initialisieren
logMessage("=== Subscription Log gestartet: " . date('Y-m-d H:i:s') . " ===" . PHP_EOL, $logFile);
logMessage("Shop: $shop" . PHP_EOL, $logFile);
logMessage("Today: $today" . PHP_EOL, $logFile);
logMessage("Target Billing Date: $targetNextBillingDate" . ($targetNextBillingDate === $today ? " (default)" : " (from --date parameter)") . PHP_EOL, $logFile);

// Cache-Status mit Quelle anzeigen
$cacheSource = '';
if ($cliArgs['cache'] === true) {
    $cacheSource = ' (from --cache parameter)';
} elseif ($cliArgs['cache'] === false) {
    $cacheSource = ' (from --no-cache parameter)';
} else {
    $cacheSource = ' (default)';
}
logMessage("Cache enabled: " . ($cacheEnabled ? 'YES' : 'NO') . $cacheSource . PHP_EOL, $logFile);
if ($cacheEnabled) {
    logMessage("Cache file: " . basename($cacheFile) . " (" . (file_exists($cacheFile) ? 'EXISTS' : 'NEW') . ")" . PHP_EOL, $logFile);
}
logMessage("Filter: ACTIVE contracts with next_billing_date between $searchWindowStart and $searchWindowEnd (Shopify search window; script still enforces $nextBillingWindowStart)" . PHP_EOL . PHP_EOL, $logFile);

// Contract IDs Log initialisieren
file_put_contents($contractIdsLogFile, "=== Contract IDs Log ===" . PHP_EOL, FILE_APPEND);
file_put_contents($contractIdsLogFile, "Date: " . date('Y-m-d H:i:s') . PHP_EOL, FILE_APPEND);
file_put_contents($contractIdsLogFile, "Shop: $shop" . PHP_EOL, FILE_APPEND);
file_put_contents($contractIdsLogFile, "Cache: " . ($cacheEnabled ? 'Enabled' : 'Disabled') . PHP_EOL, FILE_APPEND);
file_put_contents($contractIdsLogFile, "Filter: ACTIVE contracts with 28-day interval + next_billing_date window ($nextBillingWindowStart → $nextBillingWindowEnd) inside search window ($searchWindowStart → $searchWindowEnd) + current cycle not skipped" . PHP_EOL, FILE_APPEND);
file_put_contents($contractIdsLogFile, "================================" . PHP_EOL . PHP_EOL, FILE_APPEND);

// Main query for subscription contracts
$query_contracts = <<<'GRAPHQL'
query GetSubscriptions($first: Int!, $after: String, $query: String) {
  subscriptionContracts(first: $first, after: $after, query: $query) {
    pageInfo {
      hasNextPage
      endCursor
    }
    edges {
      node {
        id
        status
        createdAt
        updatedAt
        nextBillingDate
        billingPolicy {
          interval
          intervalCount
        }
        deliveryPolicy {
          interval
          intervalCount
        }
        currencyCode
        lines(first: 5) {
          edges {
            node {
              title
              quantity
              currentPrice { amount currencyCode }
              variantId
              sku
              variantTitle
              productId
            }
          }
        }
        orders(first: 5, reverse: true) {
          edges {
            node {
              id
              name
              createdAt
              totalPriceSet { shopMoney { amount } }
              displayFulfillmentStatus
            }
          }
        }
        billingAttempts(first: 10, reverse: true) {
          edges {
            node {
              id
              createdAt
              ready
              errorMessage
              errorCode
              order { id name }
            }
          }
        }
      }
    }
  }
}
GRAPHQL;

// Query for billing cycles (upcoming + recent)
// HINWEIS: Shopify API unterstützt kein billingCyclesDateRangeSelector
// Daher laden wir alle Cycles und filtern clientseitig
$query_cycles = <<<'GRAPHQL'
query GetBillingCycles(
  $contractId: ID!,
  $first: Int,
  $after: String
) {
  subscriptionBillingCycles(
    contractId: $contractId,
    first: $first,
    after: $after
  ) {
      edges {
        node {
          cycleIndex
          cycleStartAt
          cycleEndAt
          billingAttemptExpectedDate
          skipped
          status
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
 }
GRAPHQL;

// Query for single billing cycle by date selector (to check if TODAY is skipped)
$query_cycle_by_date = <<<'GRAPHQL'
query GetBillingCycleByDate($contractId: ID!, $date: DateTime!) {
  subscriptionBillingCycle(
    billingCycleInput: {
      contractId: $contractId
      selector: { date: $date }
    }
  ) {
    billingAttemptExpectedDate
    cycleIndex
    cycleStartAt
    cycleEndAt
    skipped
    status
  }
}
GRAPHQL;

// GraphQL Mutation für Billing Attempt (analog zu TS subscriptionBillingAttemptCreate)
$mutation_billing_attempt = <<<'GRAPHQL'
mutation subscriptionBillingAttemptCreate($subscriptionContractId: ID!, $subscriptionBillingAttemptInput: SubscriptionBillingAttemptInput!) {
  subscriptionBillingAttemptCreate(
    subscriptionContractId: $subscriptionContractId
    subscriptionBillingAttemptInput: $subscriptionBillingAttemptInput
  ) {
    subscriptionBillingAttempt {
      id
      idempotencyKey
      originTime
      ready
      errorCode
      errorMessage
      completedAt
      order {
        id
      }
    }
    userErrors {
      field
      message
    }
  }
}
GRAPHQL;

// Query for contract status check (analog zu TS waitForPaymentStatusUpdate)
$query_contract_status = <<<'GRAPHQL'
query getContract($id: ID!) {
  subscriptionContract(id: $id) {
    id
    status
    lastPaymentStatus
    billingAttempts(first: 3, reverse: true) {
      edges {
        node {
          id
          originTime
          ready
          errorCode
          errorMessage
          completedAt
          order {
            id
            name
          }
        }
      }
    }
  }
}
GRAPHQL;

function graphqlRequest($endpoint, $query, $variables, $token) {
    global $logFile;

    $payload = json_encode(['query' => $query, 'variables' => $variables]);

    $ch = curl_init($endpoint);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json',
        'X-Shopify-Access-Token: ' . $token
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error    = curl_error($ch);
    curl_close($ch);

    if ($httpCode !== 200 || $error) {
        logMessage("HTTP Error: $httpCode - $error<br>" . PHP_EOL, $logFile);
        return null;
    }

    $json = json_decode($response, true);

    if (isset($json['errors'])) {
        logMessage("GraphQL Errors:<br>" . PHP_EOL, $logFile);
        logMessage(print_r($json['errors'], true) . "<br>" . PHP_EOL, $logFile);
        return null;
    }

    return $json['data'] ?? null;
}

function normalizeCycleEdges($entry) {
    if (!$entry) return [];
    if (isset($entry['subscriptionBillingCycles']['edges'])) return $entry['subscriptionBillingCycles']['edges'];
    if (isset($entry['edges'])) return $entry['edges'];
    if (is_array($entry) && isset($entry[0]['node'])) return $entry;
    return [];
}

function fetchBillingCycleEdges($contractId, $endpoint, $query, $token, $selector, $pageSize = 50) {
    $edges = [];
    $cursor = null;

    do {
        $variables = [
            'contractId' => $contractId,
            'first' => $pageSize,
        ];
        if ($cursor) $variables['after'] = $cursor;

        $data = graphqlRequest($endpoint, $query, $variables, $token);
        if (!$data) {
            break;
        }

        $batch = $data['subscriptionBillingCycles']['edges'] ?? [];
        $edges = array_merge($edges, $batch);

        $pageInfo = $data['subscriptionBillingCycles']['pageInfo'] ?? [];
        $cursor = (!empty($pageInfo['hasNextPage']) && $pageInfo['hasNextPage']) ? ($pageInfo['endCursor'] ?? null) : null;
    } while ($cursor);

    return $edges;
}

/**
 * Helper: Konvertiert Shop-lokales Datum (Y-m-d) zu UTC ISO für Shopify GraphQL
 */
function toUtcIsoForShopDate(string $ymd, DateTimeZone $shopTz): string {
    $dt = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', "$ymd 00:00:00", $shopTz);
    if (!$dt) {
        throw new Exception("Invalid date format: $ymd");
    }
    return $dt->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');
}

/**
 * Prüft ob ein Contract am Target-Datum geskippt ist (analog zu TS getBillingCycleByDate)
 * Diese Funktion fragt den Billing Cycle für ein spezifisches Datum ab.
 */
function isSkippedOnTargetDate(string $contractId, string $targetYmd, string $endpoint, string $query, string $token, DateTimeZone $shopTz): bool {
    global $logFile;

    // Konvertiere Target-Datum (Y-m-d in Shop-TZ) zu UTC ISO für Shopify API
    try {
        $dateUtcIso = toUtcIsoForShopDate($targetYmd, $shopTz);
    } catch (Exception $e) {
        logMessage("  ⚠️ Error converting date for $contractId: {$e->getMessage()}<br>" . PHP_EOL, $logFile);
        return false;
    }

    $variables = [
        'contractId' => $contractId,
        'date' => $dateUtcIso,
    ];

    $data = graphqlRequest($endpoint, $query, $variables, $token);
    $cycle = $data['subscriptionBillingCycle'] ?? null;

    if (!$cycle) {
        // Kein Cycle für dieses Datum gefunden - NICHT skippen
        return false;
    }

    // Prüfe skipped flag oder SKIPPED status
    $isSkipped = ($cycle['skipped'] ?? false) === true || ($cycle['status'] ?? null) === 'SKIPPED';

    if ($isSkipped) {
        logMessage("  🔍 Cycle check for $contractId on $targetYmd: SKIPPED (index: " . ($cycle['cycleIndex'] ?? '?') . ", status: " . ($cycle['status'] ?? 'N/A') . ")<br>" . PHP_EOL, $logFile);
    }

    return $isSkipped;
}

function getBillingCycleEdges($contractId, &$cache, $useCache, $endpoint, $query, $token, $selectorKey, $selector) {
    if ($useCache) {
        if (isset($cache[$contractId][$selectorKey])) {
            return normalizeCycleEdges($cache[$contractId][$selectorKey]);
        }
        if (isset($cache[$contractId]['edges'])) {
            return normalizeCycleEdges($cache[$contractId]);
        }
    }

    $edges = fetchBillingCycleEdges($contractId, $endpoint, $query, $token, $selector);

    if ($useCache) {
        if (!isset($cache[$contractId]) || !is_array($cache[$contractId])) {
            $cache[$contractId] = [];
        }
        $cache[$contractId][$selectorKey] = ['edges' => $edges];
    }

    return $edges;
}

function isDateWithinWindow($dateTime, $startDate, $endDate, DateTimeZone $tz) {
    $localDate = toLocalDateString($dateTime, $tz);
    if (!$localDate) return false;

    return $localDate >= $startDate && $localDate <= $endDate;
}

/**
 * Erstellt einen Billing Attempt für einen Contract (analog zu TS createBillingAttempt)
 */
function createBillingAttempt(string $contractId, string $originTime, string $endpoint, string $mutation, string $token): array {
    global $logFile;

    // Idempotency Key wie in TS: rebill-{contractId}-{YYYY-MM-DD}
    $normalizedDate = (new DateTimeImmutable($originTime))->format('Y-m-d');
    $idempotencyKey = "rebill-php-{$contractId}-{$normalizedDate}";

    $variables = [
        'subscriptionContractId' => $contractId,
        'subscriptionBillingAttemptInput' => [
            'idempotencyKey' => $idempotencyKey,
            'originTime' => $originTime,
        ],
    ];

    logMessage("  📤 Creating billing attempt for $contractId<br>" . PHP_EOL, $logFile);
    logMessage("     - originTime: $originTime<br>" . PHP_EOL, $logFile);
    logMessage("     - idempotencyKey: $idempotencyKey<br>" . PHP_EOL, $logFile);

    $data = graphqlRequest($endpoint, $mutation, $variables, $token);

    if (!$data) {
        return ['success' => false, 'error' => 'GraphQL request failed'];
    }

    $result = $data['subscriptionBillingAttemptCreate'] ?? null;

    if (!empty($result['userErrors'])) {
        $errors = array_map(fn($e) => ($e['field'] ?? 'unknown') . ': ' . ($e['message'] ?? ''), $result['userErrors']);
        logMessage("  ❌ User errors: " . implode(', ', $errors) . "<br>" . PHP_EOL, $logFile);
        return [
            'success' => false,
            'error' => implode(', ', $errors),
            'userErrors' => $result['userErrors'],
        ];
    }

    $billingAttempt = $result['subscriptionBillingAttempt'] ?? null;

    if (!$billingAttempt) {
        return ['success' => false, 'error' => 'No billing attempt returned'];
    }

    logMessage("  ✅ Billing attempt created successfully<br>" . PHP_EOL, $logFile);
    logMessage("     - Attempt ID: " . ($billingAttempt['id'] ?? 'N/A') . "<br>" . PHP_EOL, $logFile);

    return [
        'success' => true,
        'billingAttempt' => $billingAttempt,
    ];
}

/**
 * Wartet auf Abschluss des Billing Attempts (analog zu TS waitForPaymentStatusUpdate)
 */
function waitForBillingCompletion(string $contractId, string $expectedOriginTime, string $endpoint, string $query, string $token, int $maxAttempts = 15, int $delayMs = 2000): array {
    global $logFile;

    $expectedTimestamp = strtotime($expectedOriginTime);

    for ($i = 0; $i < $maxAttempts; $i++) {
        logMessage("  🔍 Checking status (attempt " . ($i + 1) . "/$maxAttempts)...<br>" . PHP_EOL, $logFile);

        $data = graphqlRequest($endpoint, $query, ['id' => $contractId], $token);
        $contract = $data['subscriptionContract'] ?? null;

        if (!$contract) {
            logMessage("  ⚠️ Could not fetch contract status<br>" . PHP_EOL, $logFile);
            sleep($delayMs / 1000);
            continue;
        }

        $billingAttempts = $contract['billingAttempts']['edges'] ?? [];

        // Suche nach dem passenden Billing Attempt (±5 Sekunden Toleranz)
        foreach ($billingAttempts as $edge) {
            $attempt = $edge['node'];
            $attemptTime = $attempt['originTime'] ?? null;

            if (!$attemptTime) continue;

            $attemptTimestamp = strtotime($attemptTime);
            $timeDiff = abs($attemptTimestamp - $expectedTimestamp);

            if ($timeDiff < 5) { // 5 Sekunden Toleranz
                // Gefunden!
                if (!empty($attempt['completedAt'])) {
                    logMessage("  ✅ Billing attempt completed<br>" . PHP_EOL, $logFile);
                    logMessage("     - Status: " . ($contract['lastPaymentStatus'] ?? 'unknown') . "<br>" . PHP_EOL, $logFile);
                    logMessage("     - Order: " . ($attempt['order']['name'] ?? 'none') . "<br>" . PHP_EOL, $logFile);

                    return [
                        'completed' => true,
                        'status' => $contract['lastPaymentStatus'] ?? null,
                        'attempt' => $attempt,
                        'error' => $attempt['errorCode'] ?? null,
                    ];
                }

                if (!empty($attempt['errorCode'])) {
                    logMessage("  ❌ Billing attempt failed<br>" . PHP_EOL, $logFile);
                    logMessage("     - Error: " . ($attempt['errorMessage'] ?? $attempt['errorCode']) . "<br>" . PHP_EOL, $logFile);

                    return [
                        'completed' => true,
                        'status' => $contract['lastPaymentStatus'] ?? null,
                        'attempt' => $attempt,
                        'error' => $attempt['errorMessage'] ?? $attempt['errorCode'],
                    ];
                }

                logMessage("  ⏳ Billing attempt found but not completed yet...<br>" . PHP_EOL, $logFile);
            }
        }

        if ($i < $maxAttempts - 1) {
            usleep($delayMs * 1000); // Konvertiere ms zu microseconds
        }
    }

    logMessage("  ⚠️ Timeout waiting for billing completion<br>" . PHP_EOL, $logFile);

    return [
        'completed' => false,
        'timedOut' => true,
    ];
}

function getLastOrderCreatedAt(array $contract): ?string {
    $orders = $contract['orders']['edges'] ?? [];
    if (empty($orders)) return null;

    // Shopify often returns newest-first, but we defensively pick the max createdAt
    $max = null;
    foreach ($orders as $edge) {
        $dt = $edge['node']['createdAt'] ?? null;
        if (!$dt) continue;
        if ($max === null || $dt > $max) $max = $dt;
    }
    return $max;
}

/**
 * If nextBillingDate is stale (e.g., still in the past), compute the next expected billing date
 * by moving forward in fixed $intervalDays steps from the last successful order (fallback: createdAt)
 * until we reach the target window start.
 *
 * Returns local date string (Y-m-d) in shop timezone.
 */
function computeExpectedNextBillingLocalDate(array $contract, DateTimeImmutable $windowStartLocal, int $intervalDays, DateTimeZone $tz): ?string {
    $anchor = getLastOrderCreatedAt($contract) ?: ($contract['createdAt'] ?? null);
    if (!$anchor) return null;

    $anchorLocal = toLocalDateString($anchor, $tz);
    if (!$anchorLocal) return null;

    $anchorObj = DateTimeImmutable::createFromFormat('Y-m-d', $anchorLocal, $tz);
    if (!$anchorObj) return null;

    // Next cycle after the anchor
    $expected = $anchorObj->modify("+{$intervalDays} days");
    $windowStartDate = $windowStartLocal->format('Y-m-d');

    // If we are overdue, step forward until we are at/after the target day
    while ($expected->format('Y-m-d') < $windowStartDate) {
        $expected = $expected->modify("+{$intervalDays} days");
    }

    return $expected->format('Y-m-d');
}


function findCycleMatchingDate(array $cycleEdges, $targetDate, $toleranceDays, DateTimeZone $tz) {
    if (empty($targetDate)) return null;
    $targetDateObj = DateTimeImmutable::createFromFormat('Y-m-d', $targetDate, $tz);
    if (!$targetDateObj) return null;
    $targetTs = $targetDateObj->getTimestamp();
    $toleranceSeconds = max(0, $toleranceDays) * 86400;

    foreach ($cycleEdges as $edge) {
        $cycle = $edge['node'] ?? null;
        if (!$cycle) continue;

        $expectedLocal = toLocalDateString($cycle['billingAttemptExpectedDate'] ?? null, $tz);
        if ($expectedLocal) {
            $expectedObj = DateTimeImmutable::createFromFormat('Y-m-d', $expectedLocal, $tz);
            if ($expectedObj && abs($expectedObj->getTimestamp() - $targetTs) <= $toleranceSeconds) {
                return $cycle;
            }
        }

        $startLocal = toLocalDateString($cycle['cycleStartAt'] ?? null, $tz);
        $endLocal = toLocalDateString($cycle['cycleEndAt'] ?? null, $tz);
        if ($startLocal && $endLocal) {
            $startObj = DateTimeImmutable::createFromFormat('Y-m-d', $startLocal, $tz);
            $endObj = DateTimeImmutable::createFromFormat('Y-m-d', $endLocal, $tz);
            if ($startObj && $endObj) {
                if ($targetTs >= $startObj->getTimestamp() && $targetTs <= $endObj->getTimestamp()) {
                    return $cycle;
                }
            }
        }
    }

    return null;
}

function isExpectedBillingInterval(array $contract, $expectedDays) {
    $billingPolicy = $contract['billingPolicy'] ?? null;
    if (!$billingPolicy) return false;
    if (($billingPolicy['interval'] ?? null) !== 'DAY') return false;

    return (int) ($billingPolicy['intervalCount'] ?? 0) === (int) $expectedDays;
}

// ===== CACHE LOGIC: Fetch contracts or load from cache =====
$allContracts = [];

if ($cacheEnabled && file_exists($cacheFile)) {
    // Load from cache
    logMessage("📦 Loading contracts from cache...<br>" . PHP_EOL, $logFile);
    $cacheData = json_decode(file_get_contents($cacheFile), true);
    $allContracts = $cacheData['contracts'] ?? [];
    logMessage("✅ Loaded " . count($allContracts) . " contracts from cache<br>" . PHP_EOL, $logFile);
    logMessage("   Cache created: " . ($cacheData['timestamp'] ?? 'unknown') . "<br><br>" . PHP_EOL, $logFile);
} else {
    // Fetch from API
    logMessage("🔄 Fetching contracts from Shopify API...<br>" . PHP_EOL, $logFile);

    $cursor = null;
    $first = 50;

    do {
        $vars = ['first' => $first, 'query' => $searchQuery ?: null];
        if ($cursor) $vars['after'] = $cursor;

        $data = graphqlRequest($endpoint, $query_contracts, $vars, $accessToken);
        if (!$data) break;

        $contracts = $data['subscriptionContracts']['edges'] ?? [];
        foreach ($contracts as $edge) {
            $allContracts[] = $edge['node'];
        }

        $pageInfo = $data['subscriptionContracts']['pageInfo'] ?? [];
        $cursor = $pageInfo['hasNextPage'] ? $pageInfo['endCursor'] : null;

        logMessage("Fetched " . count($contracts) . " contracts... (cursor: " . ($cursor ?? 'end') . ")<br>" . PHP_EOL, $logFile);
    } while ($cursor);

    // Save to cache
    if ($cacheEnabled && !empty($allContracts)) {
        $cacheData = [
            'timestamp' => date('Y-m-d H:i:s'),
            'shop' => $shop,
            'total' => count($allContracts),
            'query' => $searchQuery,
            'contracts' => $allContracts
        ];
        file_put_contents($cacheFile, json_encode($cacheData, JSON_PRETTY_PRINT));
        logMessage("💾 Saved " . count($allContracts) . " contracts to cache<br>" . PHP_EOL, $logFile);
    }

    logMessage("<br>", $logFile);
}

if (empty($allContracts)) {
    logMessage("No subscription contracts found (date range might be too limited or no subscriptions exist).<br>" . PHP_EOL, $logFile);
    exit;
}

logMessage("<br>Total subscriptions: " . count($allContracts) . "<br>" . PHP_EOL, $logFile);
if ($searchQuery) logMessage("Filter: $searchQuery<br><br>" . PHP_EOL, $logFile);

logMessage("Evaluating contracts via next_billing_date window...<br>" . PHP_EOL, $logFile);

// Load billing cycles cache
$billingCyclesCache = [];
if ($cacheEnabled && file_exists($cacheBillingCyclesFile)) {
    $cachedData = json_decode(file_get_contents($cacheBillingCyclesFile), true);
    $billingCyclesCache = $cachedData['cycles'] ?? [];
    logMessage("📦 Loaded " . count($billingCyclesCache) . " billing cycles from cache<br>" . PHP_EOL, $logFile);
}

$finalContracts = [];
$contractCycleMap = [];
$skipStats = [
    'missingNextBilling' => 0,
    'outsideWindow' => 0,
    'wrongInterval' => 0,
    'currentCycleSkipped' => 0,
];

foreach ($allContracts as $contract) {
    $contractId = $contract['id'];

    if (!isExpectedBillingInterval($contract, $billingIntervalDays)) {
        $skipStats['wrongInterval']++;
        continue;
    }

    $nextBillingDate = $contract['nextBillingDate'] ?? null;

// Decide which date we should evaluate for "due today":
// 1) Prefer Shopify nextBillingDate if it matches the window
// 2) Otherwise, if nextBillingDate is stale / overdue, compute expectedNext from last order (fallback: createdAt)
$effectiveTargetDate = null;
$effectiveReason = null;

if ($nextBillingDate && isDateWithinWindow($nextBillingDate, $nextBillingWindowStart, $nextBillingWindowEnd, $shopTimezone)) {
    $effectiveTargetDate = $nextBillingWindowStart;
    $effectiveReason = 'nextBillingDate';
} else {
    $computed = computeExpectedNextBillingLocalDate($contract, $windowStartDateTime, $billingIntervalDays, $shopTimezone);

    if ($computed && $computed >= $nextBillingWindowStart && $computed <= $nextBillingWindowEnd) {
        $nextLocal = $nextBillingDate ? toLocalDateString($nextBillingDate, $shopTimezone) : null;

        // Only use computed scheduling when Shopify's nextBillingDate is missing or behind the target day.
        if ($nextBillingDate === null || ($nextLocal && $nextLocal < $nextBillingWindowStart)) {
            $effectiveTargetDate = $computed;
            $effectiveReason = 'computedFromLastOrder';
        }
    }
}

if (!$effectiveTargetDate) {
    if (!$nextBillingDate) {
        $skipStats['missingNextBilling']++;
        logMessage("  ⚠️ Contract $contractId skipped: nextBillingDate missing and no computed next date<br>" . PHP_EOL, $logFile);
    } else {
        $skipStats['outsideWindow']++;
    }
    continue;
}

// ✅ PRE-CHECK: If customer skipped the billing cycle on TARGET date, do NOT process this contract
// This is the same logic as rebill.contracts.tsx lines 910-929
$isSkipped = isSkippedOnTargetDate($contractId, $effectiveTargetDate, $endpoint, $query_cycle_by_date, $accessToken, $shopTimezone);

if ($isSkipped) {
    $skipStats['currentCycleSkipped']++;
    $nextBillingLocal = toLocalDateString($nextBillingDate, $shopTimezone) ?? 'N/A';

    logMessage("  ⏭️ Contract $contractId skipped: billing cycle on $effectiveTargetDate is SKIPPED (nextBilling: $nextBillingLocal, reason: $effectiveReason)<br>" . PHP_EOL, $logFile);
    continue; // ✅ Contract wird NICHT zu $finalContracts hinzugefügt
}

$selectorKey = $effectiveTargetDate . '|' . $effectiveTargetDate;
$cycleEdges = getBillingCycleEdges(
    $contractId,
    $billingCyclesCache,
    $cacheEnabled,
    $endpoint,
    $query_cycles,
    $accessToken,
    $selectorKey,
    [
        'start' => $billingCycleSelectorStart,
        'end' => $billingCycleSelectorEnd,
    ]
);

$currentCycle = findCycleMatchingDate($cycleEdges, $effectiveTargetDate, $currentCycleMatchToleranceDays, $shopTimezone);

    if ($currentCycle && ($currentCycle['skipped'] ?? false)) {
        $skipStats['currentCycleSkipped']++;
        logMessage("  ⏭️ Contract $contractId skipped: current billing cycle marked as skipped<br>" . PHP_EOL, $logFile);
        continue;
    }

    $finalContracts[] = $contract;
    $contractCycleMap[$contractId] = [
        'currentCycle' => $currentCycle,
        'edges' => $cycleEdges,
        'targetDate' => $effectiveTargetDate,
        'targetReason' => $effectiveReason,
    ];

    logMessage("  ✓ Contract $contractId eligible (target $effectiveTargetDate via $effectiveReason; nextBillingDate " . ($nextBillingDate ?? "N/A") . ")<br>" . PHP_EOL, $logFile);
}

// Save billing cycles cache
if ($cacheEnabled && !empty($billingCyclesCache)) {
    $cacheData = [
        'timestamp' => date('Y-m-d H:i:s'),
        'total' => count($billingCyclesCache, COUNT_RECURSIVE),
        'cycles' => $billingCyclesCache
    ];
    file_put_contents($cacheBillingCyclesFile, json_encode($cacheData, JSON_PRETTY_PRINT));
    logMessage("💾 Saved " . count($billingCyclesCache) . " billing cycles to cache<br>" . PHP_EOL, $logFile);
}

logMessage("<br>✅ Contracts ready for renewal: " . count($finalContracts) . "<br>" . PHP_EOL, $logFile);
logMessage("   • Missing nextBillingDate: {$skipStats['missingNextBilling']}<br>" . PHP_EOL, $logFile);
logMessage("   • Outside target window ($nextBillingWindowStart → $nextBillingWindowEnd): {$skipStats['outsideWindow']} (queried range $searchWindowStart → $searchWindowEnd)<br>" . PHP_EOL, $logFile);
logMessage("   • Wrong interval: {$skipStats['wrongInterval']}<br>" . PHP_EOL, $logFile);
logMessage("   • Current cycle skipped: {$skipStats['currentCycleSkipped']}<br><br>" . PHP_EOL, $logFile);

// Write ONLY the final filtered contracts to Contract IDs log
file_put_contents($contractIdsLogFile, PHP_EOL . "=== FINAL FILTERED CONTRACTS ===" . PHP_EOL, FILE_APPEND);
file_put_contents($contractIdsLogFile, "Total: " . count($finalContracts) . PHP_EOL, FILE_APPEND);
file_put_contents($contractIdsLogFile, "Criteria: ACTIVE + 28-day interval + next_billing_date window ($nextBillingWindowStart → $nextBillingWindowEnd) inside search window ($searchWindowStart → $searchWindowEnd) + current cycle not skipped" . PHP_EOL . PHP_EOL, FILE_APPEND);

foreach ($finalContracts as $idx => $contract) {
    $contractId = $contract['id'];
    $nextBilling = $contract['nextBillingDate'] ?? 'N/A';
    $currentCycle = $contractCycleMap[$contractId]['currentCycle'] ?? null;
    $cycleLabel = $currentCycle ? ("Cycle #" . ($currentCycle['cycleIndex'] ?? '?')) : 'Cycle N/A';

    // Get last order info
    $lastOrderInfo = 'No orders';
    if (!empty($contract['orders']['edges'])) {
        $lastOrder = $contract['orders']['edges'][0]['node'];
        $lastOrderDate = date('Y-m-d', strtotime($lastOrder['createdAt']));
        $daysSince = floor((strtotime($today) - strtotime($lastOrder['createdAt'])) / (60 * 60 * 24));
        $cycles = $daysSince / 28;
        $lastOrderInfo = "Last: $lastOrderDate ($daysSince days = $cycles cycles)";
    } else {
        // First billing
        $createdDate = date('Y-m-d', strtotime($contract['createdAt']));
        $daysSinceCreation = floor((strtotime($today) - strtotime($contract['createdAt'])) / (60 * 60 * 24));
        $lastOrderInfo = "Created: $createdDate ($daysSinceCreation days ago) - FIRST BILLING";
    }

    $nextBillingDay = $contractCycleMap[$contractId]['targetDate'] ?? ($nextBilling ? date('Y-m-d', strtotime($nextBilling)) : '—');
    file_put_contents($contractIdsLogFile, ($idx + 1) . ". " . $contractId . " | Next: $nextBillingDay | $cycleLabel | " . $lastOrderInfo . PHP_EOL, FILE_APPEND);
}
file_put_contents($contractIdsLogFile, PHP_EOL . "=== End of Filtered Contract IDs ===" . PHP_EOL, FILE_APPEND);

// ===== BILLING ATTEMPT PHASE =====
logMessage("<br>=== BILLING ATTEMPT PHASE ===" . PHP_EOL, $logFile);

// Configuration: CLI-Parameter haben Vorrang über Environment Variablen
$cliArgs = parseCliArguments($argv ?? []);

// Push-to-Shopify: CLI > ENV > Default (false)
if ($cliArgs['push'] !== null) {
    $pushToShopify = $cliArgs['push'];
} else {
    $pushToShopify = filter_var(getenv('PUSH_TO_SHOPIFY') ?: 'false', FILTER_VALIDATE_BOOLEAN);
}

// Test-Contract-IDs: CLI > ENV > None
if ($cliArgs['test'] !== null) {
    $testContractIds = $cliArgs['test'];
} else {
    $testContractIds = getenv('TEST_CONTRACT_IDS');
}

$testMode = !empty($testContractIds);

logMessage("Push to Shopify: " . ($pushToShopify ? 'YES ✅' : 'NO (DRY RUN) 🔸') . "<br>" . PHP_EOL, $logFile);

if ($testMode) {
    $testIds = array_map('trim', explode(',', $testContractIds));

    // Normalisiere Test-IDs: Akzeptiere sowohl kurze (123) als auch lange (gid://...) IDs
    $testIds = array_map(function($id) {
        // Wenn ID keine URL ist, füge Prefix hinzu
        if (strpos($id, 'gid://') !== 0) {
            return 'gid://shopify/SubscriptionContract/' . $id;
        }
        return $id;
    }, $testIds);

    logMessage("Test Mode: ONLY processing " . count($testIds) . " contract(s)<br>" . PHP_EOL, $logFile);

    // Extract short IDs for display
    $shortIds = array_map(function($id) {
        $parts = explode('/', $id);
        return end($parts);
    }, $testIds);
    logMessage("Test IDs: " . implode(', ', $shortIds) . "<br><br>" . PHP_EOL, $logFile);

    // Filter finalContracts to only include test IDs
    $originalCount = count($finalContracts);
    $contractsForBilling = array_filter($finalContracts, fn($c) => in_array($c['id'], $testIds));
    $contractsForBilling = array_values($contractsForBilling); // Re-index array

    logMessage("Filtered from $originalCount to " . count($contractsForBilling) . " contracts<br>" . PHP_EOL, $logFile);
} else {
    $contractsForBilling = $finalContracts;
}

logMessage("Total contracts to process: " . count($contractsForBilling) . "<br><br>" . PHP_EOL, $logFile);

if (!$pushToShopify) {
    logMessage("⚠️ DRY RUN MODE - No billing attempts will be created<br>" . PHP_EOL, $logFile);
    logMessage("   Set PUSH_TO_SHOPIFY=true to enable actual billing<br><br>" . PHP_EOL, $logFile);
}

// Process billing attempts
$billingStats = [
    'success' => 0,
    'failed' => 0,
    'skipped' => 0,
];

foreach ($contractsForBilling as $contract) {
    $contractId = $contract['id'];
    $cycleData = $contractCycleMap[$contractId] ?? null;

    if (!$cycleData) {
        logMessage("⚠️ No cycle data for $contractId - skipping<br>" . PHP_EOL, $logFile);
        $billingStats['skipped']++;
        continue;
    }

    $targetDate = $cycleData['targetDate'];
    $targetReason = $cycleData['targetReason'];

    logMessage("<br>┌─────────────────────────────────────────────<br>" . PHP_EOL, $logFile);
    logMessage("│ Processing Contract: " . basename($contractId) . "<br>" . PHP_EOL, $logFile);
    logMessage("├─────────────────────────────────────────────<br>" . PHP_EOL, $logFile);
    logMessage("│ Target Date: $targetDate (via $targetReason)<br>" . PHP_EOL, $logFile);

    // Berechne originTime (analog zu TS: targetDate in UTC um Mitternacht)
    try {
        $originTime = (new DateTimeImmutable($targetDate, $shopTimezone))
            ->setTimezone(new DateTimeZone('UTC'))
            ->setTime(0, 0, 0)
            ->format(DateTimeInterface::ATOM);

        logMessage("│ Origin Time (UTC): $originTime<br>" . PHP_EOL, $logFile);
    } catch (Exception $e) {
        logMessage("│ ❌ Error calculating originTime: {$e->getMessage()}<br>" . PHP_EOL, $logFile);
        logMessage("└─────────────────────────────────────────────<br>" . PHP_EOL, $logFile);
        $billingStats['failed']++;
        continue;
    }

    if (!$pushToShopify) {
        logMessage("│ 🔸 DRY RUN - Would create billing attempt<br>" . PHP_EOL, $logFile);
        logMessage("└─────────────────────────────────────────────<br>" . PHP_EOL, $logFile);
        $billingStats['skipped']++;
        continue;
    }

    // Erstelle Billing Attempt
    logMessage("├─────────────────────────────────────────────<br>" . PHP_EOL, $logFile);
    $result = createBillingAttempt($contractId, $originTime, $endpoint, $mutation_billing_attempt, $accessToken);

    if (!$result['success']) {
        logMessage("│ ❌ Failed: " . ($result['error'] ?? 'Unknown error') . "<br>" . PHP_EOL, $logFile);
        logMessage("└─────────────────────────────────────────────<br>" . PHP_EOL, $logFile);
        $billingStats['failed']++;
        continue;
    }

    // Warte auf Abschluss
    logMessage("├─────────────────────────────────────────────<br>" . PHP_EOL, $logFile);
    logMessage("│ Waiting for billing completion...<br>" . PHP_EOL, $logFile);
    $statusResult = waitForBillingCompletion($contractId, $originTime, $endpoint, $query_contract_status, $accessToken);

    if ($statusResult['completed'] && empty($statusResult['error'])) {
        $billingStats['success']++;
        logMessage("│ ✅ Billing completed successfully<br>" . PHP_EOL, $logFile);
        if (!empty($statusResult['attempt']['order']['name'])) {
            logMessage("│    Order created: " . $statusResult['attempt']['order']['name'] . "<br>" . PHP_EOL, $logFile);
        }
    } else {
        $billingStats['failed']++;
        $errorMsg = $statusResult['error'] ?? ($statusResult['timedOut'] ? 'Timeout' : 'Unknown error');
        logMessage("│ ❌ Billing failed: $errorMsg<br>" . PHP_EOL, $logFile);
    }

    logMessage("└─────────────────────────────────────────────<br>" . PHP_EOL, $logFile);

    // Rate limiting (analog zu TS: 1 Sekunde Pause)
    sleep(1);
}

// Final Summary
logMessage("<br>=== BILLING SUMMARY ===" . PHP_EOL, $logFile);
logMessage("Total contracts: " . count($contractsForBilling) . PHP_EOL, $logFile);
logMessage("✅ Successful: " . $billingStats['success'] . PHP_EOL, $logFile);
logMessage("❌ Failed: " . $billingStats['failed'] . PHP_EOL, $logFile);
logMessage("🔸 Skipped/Dry-run: " . $billingStats['skipped'] . PHP_EOL, $logFile);
logMessage("======================<br><br>" . PHP_EOL, $logFile);

// ===== DETAILED LOG FOR DEBUGGING =====
logMessage("<br>=== DETAILED CONTRACT LOG ===" . PHP_EOL, $logFile);

// Display complete information
foreach ($finalContracts as $i => $contract) {
    $contractId = $contract['id'];
    $currentCycle = $contractCycleMap[$contractId]['currentCycle'] ?? null;

    logMessage("┌───────────────────────────────────────────────┐<br>" . PHP_EOL, $logFile);
    logMessage("  Subscription #" . ($i+1) . "   ID: $contractId<br>" . PHP_EOL, $logFile);
    logMessage("  Status: {$contract['status']}<br>" . PHP_EOL, $logFile);
    logMessage("  Created: {$contract['createdAt']}<br>" . PHP_EOL, $logFile);
    logMessage("  Next billing: " . ($contract['nextBillingDate'] ?? '—') . "<br>" . PHP_EOL, $logFile);

    // Billing interval info
    $billingPolicy = $contract['billingPolicy'] ?? null;
    if ($billingPolicy) {
        $interval = $billingPolicy['interval'] ?? '?';
        $intervalCount = $billingPolicy['intervalCount'] ?? '?';
        logMessage("  Billing interval: Every {$intervalCount} {$interval}(s)<br>" . PHP_EOL, $logFile);
    }

    if ($currentCycle) {
        $cycleStatus = $currentCycle['status'] ?? 'N/A';
        $expectedAttempt = $currentCycle['billingAttemptExpectedDate'] ?? '—';
        $skippedText = ($currentCycle['skipped'] ?? false) ? ' [SKIPPED]' : '';
        logMessage("  Current cycle #" . ($currentCycle['cycleIndex'] ?? '?') . ": attempt $expectedAttempt ($cycleStatus)$skippedText<br>" . PHP_EOL, $logFile);
    }

    logMessage("  ───────────────────────────────────────────────<br>" . PHP_EOL, $logFile);

    // Last orders
    logMessage("  Last orders:<br>" . PHP_EOL, $logFile);
    foreach ($contract['orders']['edges'] ?? [] as $oEdge) {
        $o = $oEdge['node'];
        logMessage("    • {$o['name']} - {$o['createdAt']} - {$o['totalPriceSet']['shopMoney']['amount']} {$contract['currencyCode']}<br>" . PHP_EOL, $logFile);
    }

    // Recent billing attempts
    logMessage("<br>  Recent billing attempts:<br>" . PHP_EOL, $logFile);
    foreach ($contract['billingAttempts']['edges'] ?? [] as $aEdge) {
        $a = $aEdge['node'];
        $status = $a['ready'] ? 'Ready' : ($a['errorMessage'] ? "Failed: {$a['errorMessage']}" : 'Pending');
        logMessage("    • {$a['createdAt']} → $status  " . ($a['order']['name'] ?? '') . "<br>" . PHP_EOL, $logFile);
    }

    // Billing cycles (upcoming/recent)
    logMessage("<br>  Billing Cycles:<br>" . PHP_EOL, $logFile);
    $cycleEdges = $contractCycleMap[$contractId]['edges'] ?? [];

    if (!empty($cycleEdges)) {
        foreach ($cycleEdges as $cEdge) {
            $c = $cEdge['node'];
            $expected = $c['billingAttemptExpectedDate'] ?? '—';
            $skippedStatus = ($c['skipped'] ?? false) ? ' [SKIPPED]' : '';
            $status = isset($c['status']) ? " ({$c['status']})" : '';
            logMessage("    • Cycle {$c['cycleIndex']}: {$c['cycleStartAt']} → {$c['cycleEndAt']} (attempt: $expected)$status$skippedStatus<br>" . PHP_EOL, $logFile);
        }
    } else {
        logMessage("    — No billing cycles data —<br>" . PHP_EOL, $logFile);
    }

    logMessage("<hr><br>" . PHP_EOL, $logFile);
}

logMessage("Done.<br>" . PHP_EOL, $logFile);
