import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { ApiVersion, shopifyApi } from "@shopify/shopify-api";
import { sessionStorage } from "~/shopify.server";
import * as process from "node:process";
import { DateTime } from "luxon";
import fs from "fs";
import path from "path";

// Old-orders job runs on a strict 28-day recovery cadence
const OLD_ORDERS_INTERVAL_DAYS = 28;

function resolveCoreApi() {
  const core = (shopifyApi as any)?.api;
  if (core?.clients?.Graphql) return core;

  const hostName = (process.env.SHOPIFY_APP_URL || process.env.APP_URL || "example.com").replace(
    /^https?:\/\//,
    "",
  );

  if (!process.env.SHOPIFY_API_KEY || !process.env.SHOPIFY_API_SECRET) {
    throw new Error("Missing SHOPIFY_API_KEY or SHOPIFY_API_SECRET in .env");
  }

  return shopifyApi({
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET,
    apiVersion: ApiVersion.July24,
    hostName,
  });
}

async function getAdminClientForShop(shop: string) {
  const offlineId = `offline_${shop}`;
  let session = await sessionStorage.loadSession(offlineId);

  if (!session) {
    const list = await sessionStorage.findSessionsByShop(shop);
    if (list && list.length > 0) {
      session = list.find((s: any) => !s.isOnline) ?? list[0];
    }
  }

  if (!session?.accessToken) {
    throw new Error(`No valid offline app session found for shop ${shop}`);
  }

  const core = resolveCoreApi();
  const admin = new core.clients.Graphql({ session });
  return admin;
}

// Separate Query für Billing Cycles eines Contracts
const GET_BILLING_CYCLES_QUERY = `
  query SubscriptionBillingCycles($contractId: ID!, $first: Int!, $after: String) {
    subscriptionBillingCycles(
      contractId: $contractId,
      first: $first,
      after: $after,
      billingCyclesIndexRangeSelector: {
        startIndex: 0
      }
    ) {
      edges {
        node {
          billingAttemptExpectedDate
          cycleIndex
          cycleStartAt
          cycleEndAt
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
`;

const GET_CONTRACTS_QUERY = `
  query getSubscriptionContracts($first: Int!, $after: String, $query: String) {
    subscriptionContracts(first: $first, after: $after, query: $query) {
      edges {
        node {
          id
          status
          lastPaymentStatus
          nextBillingDate
          deliveryPolicy {
            interval
            intervalCount
          }
          billingAttempts(first: 5, reverse: true) {
            edges {
              node {
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
            }
          }
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const UPDATE_NEXT_BILLING_DATE_MUTATION = `
  mutation subscriptionContractNextBillingDateUpdate($contractId: ID!, $nextBillingDate: DateTime!) {
    subscriptionContractNextBillingDateUpdate(
      contractId: $contractId,
      nextBillingDate: $nextBillingDate
    ) {
      subscriptionContract {
        id
        nextBillingDate
      }
      userErrors {
        field
        message
      }
    }
  }
`;

function writeTextLog(entry: unknown, fileName = "custom_log_sub_job.log") {
  const logDir = path.join(process.cwd(), "logs");
  const filePath = path.join(logDir, fileName);

  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });

  }

  // Wenn ein Objekt übergeben wird, als JSON formatieren
  const text =
    typeof entry === "string"
      ? entry
      : JSON.stringify(entry, null, 2);

  const line = `[${new Date().toISOString()}] ${text}\n`;
  fs.appendFileSync(filePath, line, { encoding: "utf-8" });
}

// Neue Funktion zum Abrufen des aktuellen Contract-Status
async function getContractStatus(admin: any, contractId: string) {
  const query = `
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
              }
            }
          }
        }
      }
    }
  `;

  const response = await admin.query({
    data: {
      query,
      variables: { id: contractId },
    },
  });

  return response.body?.data?.subscriptionContract;
}

// Neue Funktion: Wartet auf Statusaktualisierung
async function waitForPaymentStatusUpdate(
  admin: any,
  contractId: string,
  expectedOriginTime: string, // NEU: Die originTime, die wir im Request gesendet haben
  maxAttempts = 15, // Erhöht auf 15 Versuche
  delayMs = 2000
) {
  const expectedDate = new Date(expectedOriginTime).getTime();

  for (let i = 0; i < maxAttempts; i++) {
    writeTextLog(`Checking status for ${contractId}, attempt ${i + 1}/${maxAttempts}`);

    const contract = await getContractStatus(admin, contractId);
    const billingAttempts = contract?.billingAttempts?.edges || [];

    writeTextLog({
      message: `Status check for ${contractId}`,
      attempt: i + 1,
      lastPaymentStatus: contract?.lastPaymentStatus,
      totalBillingAttempts: billingAttempts.length,
      expectedOriginTime,
    });

    // Suche nach einem billingAttempt mit der erwarteten originTime
    const matchingAttempt = billingAttempts.find((edge: any) => {
      const attemptOriginTime = edge.node.originTime;
      const attemptDate = new Date(attemptOriginTime).getTime();

      // Vergleiche mit einer Toleranz von 5 Sekunden
      const timeDiff = Math.abs(attemptDate - expectedDate);
      return timeDiff < 5000; // 5 Sekunden Toleranz
    });

    if (matchingAttempt) {
      const attempt = matchingAttempt.node;
      writeTextLog({
        message: `Found matching billing attempt for ${contractId}`,
        attemptId: attempt.id,
        originTime: attempt.originTime,
        ready: attempt.ready,
        completedAt: attempt.completedAt,
        errorCode: attempt.errorCode,
      });

      // Wenn completedAt gesetzt ist, ist der Versuch abgeschlossen
      if (attempt.completedAt) {
        return {
          completed: true,
          status: contract.lastPaymentStatus,
          attempt: attempt,
          foundNew: true,
        };
      }

      // Wenn ein Fehler vorliegt
      if (attempt.errorCode) {
        return {
          completed: true,
          status: contract.lastPaymentStatus,
          attempt: attempt,
          error: attempt.errorMessage,
          foundNew: true,
        };
      }

      // Gefunden aber noch nicht abgeschlossen - weiter warten
      writeTextLog(`Billing attempt found but not completed yet, waiting...`);
    } else {
      writeTextLog(`No matching billing attempt found yet, will retry...`);
    }

    // Warte vor dem nächsten Versuch
    if (i < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return { completed: false, timedOut: true, foundNew: false };
}

// Neue Funktion: Aktualisiert die nextBillingDate nach erfolgreichem Billing
// WICHTIG: Shopify aktualisiert nextBillingDate NICHT automatisch bei manuellen Billing Attempts!
// Wir berechnen die neue nextBillingDate basierend auf HEUTE (dem tatsächlichen Billing-Datum)
async function updateNextBillingDate(admin: any, contractId: string, currentNextBillingDate: string, billingIntervalDays: number) {
  // Berechne die neue nextBillingDate auf Basis der vorherigen nextBillingDate
  const baseDate = currentNextBillingDate
    ? DateTime.fromISO(currentNextBillingDate, { zone: 'utc' }).startOf('day')
    : DateTime.utc().startOf('day');
  const daysToAdd = OLD_ORDERS_INTERVAL_DAYS;
  const newNextBillingDate = baseDate.plus({ days: daysToAdd }).toISO();
  const usedFallback = !currentNextBillingDate;

  try {
    writeTextLog({
      message: `Updating nextBillingDate for ${contractId}`,
      currentNextBillingDate: currentNextBillingDate,
      baseDate: baseDate.toISO(),
      usedFallback,
       newNextBillingDate: newNextBillingDate,
       originalIntervalDays: billingIntervalDays,
       enforcedIntervalDays: daysToAdd,
      calculation: `Base (${baseDate.toISO()}) + ${daysToAdd} days = ${newNextBillingDate}`,
      note: usedFallback
        ? "Fallback to today because currentNextBillingDate was missing"
        : "Old nextBillingDate extended by fixed 28-day cadence"
    });

    const response = await admin.query({
      data: {
        query: UPDATE_NEXT_BILLING_DATE_MUTATION,
        variables: {
          contractId,
          nextBillingDate: newNextBillingDate,
        },
      },
    });

    const result = response.body?.data?.subscriptionContractNextBillingDateUpdate;

    writeTextLog({
      message: `NextBillingDate update response for ${contractId}`,
      result: result,
    });

    if (result?.userErrors && result.userErrors.length > 0) {
      const errors = result.userErrors.map((e: any) => `${e.field?.join(',') || 'unknown'}: ${e.message}`).join(", ");
      return {
        success: false,
        error: errors,
        userErrors: result.userErrors
      };
    }

    // Shopify hat die nextBillingDate automatisch aktualisiert
    return {
      success: true,
      nextBillingDate: result?.subscriptionContract?.nextBillingDate || newNextBillingDate
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    writeTextLog({
      message: `Error updating nextBillingDate for ${contractId}`,
      error: errorMessage
    });
    return { success: false, error: errorMessage };
  }
}

// Neue Funktion: Erstellt direkt einen Billing Attempt
async function createBillingAttempt(admin: any, contractId: string, originTime: string) {
  const mutation = `
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
  `;

  try {
    writeTextLog({
      message: `Creating billing attempt for ${contractId}`,
      originTime
    });

    const response = await admin.query({
      data: {
        query: mutation,
        variables: {
          subscriptionContractId: contractId,
          subscriptionBillingAttemptInput: {
            idempotencyKey: `rebill-${contractId}-${DateTime.fromISO(originTime, {zone:"utc"}).toISODate()}`,
            originTime: originTime,
          },
        },
      },
    });

    const result = response.body?.data?.subscriptionBillingAttemptCreate;

    writeTextLog({
      message: `Billing attempt creation response for ${contractId}`,
      result: result,
    });

    if (result?.userErrors && result.userErrors.length > 0) {
      const errors = result.userErrors.map((e: any) => `${e.field}: ${e.message}`).join(", ");
      return {
        success: false,
        error: errors,
        userErrors: result.userErrors
      };
    }

    if (!result?.subscriptionBillingAttempt) {
      return {
        success: false,
        error: "No billing attempt returned from API"
      };
    }

    return {
      success: true,
      billingAttempt: result.subscriptionBillingAttempt
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    writeTextLog({
      message: `Error creating billing attempt for ${contractId}`,
      error: errorMessage
    });
    return { success: false, error: errorMessage };
  }
}

// Neue Funktion: Rufe Billing Cycles für einen Contract ab
async function getBillingCycles(admin: any, contractId: string) {
  try {
    const response = await admin.query({
      data: {
        query: GET_BILLING_CYCLES_QUERY,
        variables: {
          contractId: contractId,
          first: 10,
          after: null
        },
      },
    });

    const data = response.body;
    if (data.errors) {
      writeTextLog({
        message: `Error fetching billing cycles for ${contractId}`,
        errors: data.errors
      });
      return null;
    }

    return data.data?.subscriptionBillingCycles?.edges || [];
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    writeTextLog({
      message: `Error fetching billing cycles for ${contractId}`,
      error: errorMessage
    });
    return null;
  }
}

export async function action({ request }: ActionFunctionArgs) {
  writeTextLog(`Received POST to /rebill/contracts at ${new Date().toISOString()}`);

  if (request.method !== "POST") {
    writeTextLog(`Invalid method: ${request.method}`);
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const shop = process.env.SHOPIFY_SHOP;
  if (!shop) {
    writeTextLog("No shop defined in SHOPIFY_SHOP");
    return json({ error: "No shop defined" }, { status: 500 });
  }

  let admin;
  try {
    writeTextLog(`Fetching admin client for shop: ${shop}`);
    admin = await getAdminClientForShop(shop);
    writeTextLog(`Got admin client for ${shop}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    writeTextLog({ message: "Failed to get admin client", error: errorMessage });
    console.error("Failed to get admin client:", error);
    return json(
      { error: `Failed to authenticate: ${errorMessage}` },
      { status: 401 }
    );
  }

  let afterCursor: string | null = null;
  let allContracts: { id: string; nextBillingDate?: string }[] = [];
  const batchSize = 50;
  let successCount = 0;
  let failureCount = 0;
  const results: {
    id: string;
    success: boolean;
    error?: string;
    initialStatus?: string;
    finalStatus?: string;
    billingAttempt?: any;
    completed?: boolean;
    timedOut?: boolean;
    foundNew?: boolean;
    userErrors?: any[];
    nextBillingDateUpdated?: boolean;
    newNextBillingDate?: string;
  }[] = [];


  try {
    writeTextLog("Starting to fetch contracts...");
    do {
      writeTextLog(`Fetching batch with afterCursor: ${afterCursor || "null"}`);
      const response = await admin.query({
        data: {
          query: GET_CONTRACTS_QUERY,
          variables: {
            first: batchSize,
            after: afterCursor,
            query: "status:ACTIVE",
          },
        },
      });

      const data = response.body;
      if (!data.data && !data.errors) {
        throw new Error("Invalid GraphQL response: no data or errors");
      }
      if (data.errors) {
        writeTextLog({ message: "GraphQL errors", errors: data.errors });
        console.error("GraphQL errors:", JSON.stringify(data.errors));
        throw new Error(`GraphQL query failed: ${JSON.stringify(data.errors)}`);
      }

      const edges = data.data?.subscriptionContracts?.edges || [];
      const pageInfo = data.data?.subscriptionContracts?.pageInfo;
      writeTextLog(`Fetched ${edges.length} contracts in this batch`);

      const allowedIds = new Set([
        "gid://shopify/SubscriptionContract/30515364186",
      ]);

      const contractsThisPage = edges
        .map((edge: any) => ({
          id: edge.node.id,
          nextBillingDate: edge.node.nextBillingDate,
          lastPaymentStatus: edge.node.lastPaymentStatus,
          billingAttempts: edge.node.billingAttempts,
          deliveryPolicy: edge.node.deliveryPolicy,
        }))
        .filter((contract) => {
          return allowedIds.has(contract.id);
        });

      allContracts = allContracts.concat(contractsThisPage);

      for (const contract of contractsThisPage) {
        // Extrahiere Informationen vom Contract
        const lastBillingAttempt = contract.billingAttempts?.edges?.[0]?.node;
        const nextBillingDate = contract.nextBillingDate;

        writeTextLog({
          message: `Processing contract ${contract.id}`,
          lastPaymentStatus: contract.lastPaymentStatus,
          nextBillingDate: nextBillingDate,
          lastBillingAttempt: lastBillingAttempt ? {
            id: lastBillingAttempt.id,
            originTime: lastBillingAttempt.originTime,
            completedAt: lastBillingAttempt.completedAt,
            order: lastBillingAttempt.order,
          } : null
        });

        // Prüfe ob nextBillingDate gesetzt ist
        if (!nextBillingDate) {
          writeTextLog({
            message: `Skipping ${contract.id} - no nextBillingDate set`,
            contractId: contract.id
          });
          results.push({
            id: contract.id,
            success: false,
            error: "No nextBillingDate set"
          });
          failureCount++;
          continue;
        }

        // ✅ SCHRITT 1: Berechne wie viele Tage überfällig der Contract ist
        const today = DateTime.utc().startOf('day');
        const nextBillingDateTime = DateTime.fromISO(nextBillingDate, { zone: "utc" }).startOf('day');
        const daysOverdue = Math.floor(today.diff(nextBillingDateTime, 'days').days);

        writeTextLog({
          message: `Billing date check for ${contract.id}`,
          nextBillingDate: nextBillingDate,
          today: today.toISO(),
          daysOverdue: daysOverdue,
          isDue: daysOverdue >= 0
        });

        // ✅ SCHRITT 2: Rufe Billing Cycles ab (präziser als deliveryPolicy!)
        const billingCyclesEdges = await getBillingCycles(admin, contract.id);
        const billingCycles = billingCyclesEdges?.map((edge: any) => edge.node) || [];

        writeTextLog({
          message: `Fetched billing cycles for ${contract.id}`,
          totalCycles: billingCycles.length,
          cycles: billingCycles.slice(0, 3).map((cycle: any) => ({
            index: cycle.cycleIndex,
            startAt: cycle.cycleStartAt,
            endAt: cycle.cycleEndAt,
            expectedDate: cycle.billingAttemptExpectedDate,
            status: cycle.status,
            skipped: cycle.skipped
          }))
        });

        // Finde den aktuellen Billing Cycle (basierend auf nextBillingDate)
        let currentCycle: any = null;
        let nextCycle: any = null;

        for (const cycle of billingCycles) {
          if (!cycle.billingAttemptExpectedDate) continue;

          const cycleExpectedDate = DateTime.fromISO(cycle.billingAttemptExpectedDate, { zone: "utc" }).startOf('day');

          // Der aktuelle Cycle ist der mit der nextBillingDate (±2 Tage Toleranz)
          if (Math.abs(cycleExpectedDate.diff(nextBillingDateTime, 'days').days) <= 2) {
            currentCycle = cycle;
          }

          // Der nächste Cycle ist der nach dem aktuellen
          if (currentCycle && !nextCycle && cycle.cycleIndex > currentCycle.cycleIndex) {
            nextCycle = cycle;
          }
        }

        // Berechne Intervall aus deliveryPolicy (verlässlichste Quelle)
        let intervalDays = 28; // Default fallback
        let intervalSource = "default";

        const deliveryPolicy = contract.deliveryPolicy;

        if (deliveryPolicy) {
          const interval = deliveryPolicy.interval;
          const intervalCount = deliveryPolicy.intervalCount || 1;

          switch (interval) {
            case "DAY":
              intervalDays = intervalCount;
              break;
            case "WEEK":
              intervalDays = intervalCount * 7;
              break;
            case "MONTH":
              intervalDays = intervalCount * 30;
              break;
            case "YEAR":
              intervalDays = intervalCount * 365;
              break;
          }
          intervalSource = "deliveryPolicy";

          writeTextLog({
            message: `Calculated interval from deliveryPolicy for ${contract.id}`,
            intervalDays: intervalDays,
            interval: interval,
            intervalCount: intervalCount,
            source: intervalSource
          });
        }

        // Force the job to respect the 28-day SLA regardless of delivery policy
        intervalDays = OLD_ORDERS_INTERVAL_DAYS;
        intervalSource = "oldOrdersOverride";
        writeTextLog({
          message: `Overriding interval for ${contract.id} to ${OLD_ORDERS_INTERVAL_DAYS} days`,
          contractId: contract.id,
          intervalDays,
          note: "Old-orders job enforces fixed cadence"
        });

        // ✅ WICHTIGE PRÜFUNG: Contract muss fällig sein (nextBillingDate heute oder in der Vergangenheit)
        // Für allowedIds: Contract wird verarbeitet wenn nextBillingDate heute oder in der Vergangenheit liegt
        if (daysOverdue < 0) {
          writeTextLog({
            message: `Skipping ${contract.id} - nextBillingDate is in the future`,
            contractId: contract.id,
            daysOverdue: daysOverdue,
            nextBillingDate: nextBillingDate,
            note: `nextBillingDate is ${Math.abs(daysOverdue)} days in the future. Contract not due yet.`
          });
          results.push({
            id: contract.id,
            success: false,
            error: `nextBillingDate is ${Math.abs(daysOverdue)} days in the future`
          });
          failureCount++;
          continue;
        }

        writeTextLog({
          message: `✅ Contract is ${daysOverdue} days overdue (>= 0) - proceeding with renewal`,
          contractId: contract.id,
          daysOverdue: daysOverdue,
          nextBillingDate: nextBillingDate,
          note: `Contract is due for billing. Processing renewal now.`
        });

        // ✅ SCHRITT 3: Berechne originTime - verwende Billing Cycle Daten wenn verfügbar
        // Da wir jetzt wissen dass der Contract EXAKT intervalDays überfällig ist, verwenden wir HEUTE als originTime
        let originTime: string;
        let originTimeSource: string;

        if (currentCycle && currentCycle.billingAttemptExpectedDate) {
          // Prüfe ob die Billing Cycle expectedDate innerhalb vernünftiger Toleranz ist
          const cycleExpectedDate = DateTime.fromISO(currentCycle.billingAttemptExpectedDate, { zone: "utc" }).startOf('day');
          const daysDifference = Math.abs(today.diff(cycleExpectedDate, 'days').days);

          // Wenn Billing Cycle expectedDate nahe am erwarteten Datum liegt (±3 Tage), verwende es
          if (daysDifference <= 3) {
            originTime = cycleExpectedDate.toISO() as string;
            originTimeSource = "billingCycle.expectedDate";

            writeTextLog({
              message: `Using billing cycle expectedDate as originTime for ${contract.id}`,
              cycleIndex: currentCycle.cycleIndex,
              billingAttemptExpectedDate: currentCycle.billingAttemptExpectedDate,
              daysDifference: daysDifference,
              originTime: originTime,
              source: originTimeSource
            });
          } else {
            // Billing Cycle expectedDate ist zu weit weg - verwende HEUTE
            originTime = today.toISO() as string;
            originTimeSource = "today (cycle expectedDate too far off)";

            writeTextLog({
              message: `⚠️ Billing cycle expectedDate is too far from expected date - using TODAY for ${contract.id}`,
              cycleExpectedDate: currentCycle.billingAttemptExpectedDate,
              daysDifference: daysDifference,
              today: today.toISO(),
              originTime: originTime,
              source: originTimeSource
            });
          }
        } else {
          // Kein Billing Cycle verfügbar - verwende HEUTE
          originTime = today.toISO() as string;
          originTimeSource = "today (no cycle available)";

          writeTextLog({
            message: `Using TODAY as originTime for ${contract.id}`,
            daysOverdue: daysOverdue,
            intervalDays: intervalDays,
            today: today.toISO(),
            originTime: originTime,
            source: originTimeSource,
            note: `Contract is exactly ${intervalDays} days overdue - using today's date`
          });
        }

        // ✅ SCHRITT 4: Prüfe ob bereits ein erfolgreicher Billing Attempt existiert
        // Verwende Billing Cycle Zeiträume wenn verfügbar (präziser!), sonst ±2 Tage Toleranz
        let hasSuccessfulAttemptForCurrentCycle = false;

        if (currentCycle && currentCycle.cycleStartAt && currentCycle.cycleEndAt) {
          // ✅ PRÄZISE Prüfung mit Billing Cycle Zeiträumen
          const cycleStartDate = DateTime.fromISO(currentCycle.cycleStartAt, { zone: 'utc' });
          const cycleEndDate = DateTime.fromISO(currentCycle.cycleEndAt, { zone: 'utc' });

          hasSuccessfulAttemptForCurrentCycle = contract.billingAttempts?.edges?.some((edge: any) => {
            const attempt = edge.node;
            if (!attempt.originTime || !attempt.completedAt || !attempt.order?.id || attempt.errorCode) {
              return false;
            }

            const attemptOriginTime = DateTime.fromISO(attempt.originTime, { zone: 'utc' });

            // Prüfe ob der Attempt innerhalb des Cycle-Zeitraums liegt
            return attemptOriginTime >= cycleStartDate && attemptOriginTime <= cycleEndDate;
          });

          if (hasSuccessfulAttemptForCurrentCycle) {
            writeTextLog({
              message: `Skipping ${contract.id} - successful billing attempt within current billing cycle period`,
              contractId: contract.id,
              cycleIndex: currentCycle.cycleIndex,
              cycleStartAt: currentCycle.cycleStartAt,
              cycleEndAt: currentCycle.cycleEndAt,
              note: "A billing attempt within this billing cycle period was already completed successfully."
            });
          }
        } else {
          // Fallback: Prüfe auf Attempts nahe der originTime (±2 Tage)
          const originTimeDate = DateTime.fromISO(originTime, { zone: 'utc' }).startOf('day');

          hasSuccessfulAttemptForCurrentCycle = contract.billingAttempts?.edges?.some((edge: any) => {
            const attempt = edge.node;
            if (!attempt.originTime || !attempt.completedAt || !attempt.order?.id || attempt.errorCode) {
              return false;
            }

            const attemptOriginTime = DateTime.fromISO(attempt.originTime, { zone: 'utc' }).startOf('day');
            const daysDifference = Math.abs(attemptOriginTime.diff(originTimeDate, 'days').days);

            return daysDifference <= 2; // Toleranz von 2 Tagen
          });

          if (hasSuccessfulAttemptForCurrentCycle) {
            writeTextLog({
              message: `Skipping ${contract.id} - successful billing attempt near originTime`,
              contractId: contract.id,
              originTime: originTime,
              note: "A billing attempt near the calculated originTime (±2 days) was already completed successfully."
            });
          }
        }

        if (hasSuccessfulAttemptForCurrentCycle) {
          results.push({
            id: contract.id,
            success: false,
            error: `Billing attempt for originTime ${originTime} already completed successfully`
          });
          failureCount++;
          continue;
        }

        // ✅ SCHRITT 5: Zusätzliche Sicherheit - prüfe ob bereits heute ein Attempt erstellt wurde
        // const todayStart = DateTime.utc().startOf('day');
        // const todayEnd = DateTime.utc().endOf('day');
        //
        // const hasTodayAttempt = contract.billingAttempts?.edges?.some((edge: any) => {
        //   const attemptTime = edge.node.originTime;
        //   if (!attemptTime) return false;
        //
        //   const attemptDateTime = DateTime.fromISO(attemptTime, { zone: 'utc' });
        //   return attemptDateTime >= todayStart && attemptDateTime <= todayEnd;
        // });
        //
        // if (hasTodayAttempt) {
        //   writeTextLog({
        //     message: `Skipping ${contract.id} - billing attempt already created today`,
        //     contractId: contract.id,
        //     nextBillingDate: nextBillingDate
        //   });
        //   results.push({
        //     id: contract.id,
        //     success: false,
        //     error: "Billing attempt already created today"
        //   });
        //   failureCount++;
        //   continue;
        // }
        // ✅ SCHRITT 6: Erstelle Billing Attempt mit der neuen originTime
        writeTextLog({
          message: `Contract is due for renewal - proceeding with billing attempt`,
          contractId: contract.id,
          originTime: originTime,
          nextBillingDate: nextBillingDate,
          daysOverdue: daysOverdue,
          intervalDays: intervalDays,
          note: `Creating billing attempt for contract that is ${daysOverdue} days overdue (min ${intervalDays})`
        });

        // Verwende createBillingAttempt statt sendRebillRequest für direkten GraphQL Zugriff
        // originTime ist garantiert nicht null, da es aus nextBillingDate berechnet wurde
        const rebillResult = await createBillingAttempt(admin, contract.id, originTime as string);

        if (rebillResult.success) {
          writeTextLog(`Billing attempt created successfully for ${contract.id}`);
          writeTextLog(`Waiting for payment status update for ${contract.id} with originTime ${originTime}`);

          const statusResult = await waitForPaymentStatusUpdate(admin, contract.id, originTime as string);

          // ✅ WICHTIG: Aktualisiere nextBillingDate nach erfolgreichem Billing
          let nextBillingUpdateResult: {
            success: boolean;
            error?: string;
            nextBillingDate?: string;
            billingCycle?: any;
            userErrors?: any[];
          } | undefined = undefined;

          if (statusResult.completed && !statusResult.error) {
            // intervalDays wurde bereits oben berechnet

            writeTextLog({
              message: `Updating nextBillingDate for ${contract.id}`,
              intervalDays: intervalDays,
              intervalSource: intervalSource,
              currentCycleIndex: currentCycle?.cycleIndex,
              currentNextBillingDate: contract.nextBillingDate
            });

            // Verwende die aktuelle nextBillingDate aus dem Contract
            nextBillingUpdateResult = await updateNextBillingDate(
              admin,
              contract.id,
              contract.nextBillingDate,
              intervalDays
            );

            if (nextBillingUpdateResult?.success) {
              writeTextLog({
                message: `✅ Successfully updated nextBillingDate for ${contract.id}`,
                newNextBillingDate: nextBillingUpdateResult.nextBillingDate,
                calculation: `Previous nextBillingDate + ${intervalDays} days`
              });
            } else {
              writeTextLog({
                message: `⚠️ Failed to update nextBillingDate for ${contract.id}`,
                error: nextBillingUpdateResult?.error,
                warning: "Billing was successful, but nextBillingDate update failed. Manual intervention may be needed."
              });
            }
          } else if (statusResult.error) {
            writeTextLog({
              message: `⚠️ Billing attempt completed with error for ${contract.id}`,
              error: statusResult.error,
              errorCode: statusResult.attempt?.errorCode,
              note: "nextBillingDate NOT updated - will retry on next run"
            });
          } else if (statusResult.timedOut) {
            writeTextLog({
              message: `⚠️ Status check timed out for ${contract.id}`,
              note: "nextBillingDate NOT updated - will retry on next run"
            });
          }

          results.push({
            id: contract.id,
            success: true,
            initialStatus: contract.lastPaymentStatus,
            finalStatus: statusResult.status,
            billingAttempt: statusResult.attempt,
            completed: statusResult.completed,
            timedOut: statusResult.timedOut,
            foundNew: statusResult.foundNew,
            nextBillingDateUpdated: nextBillingUpdateResult?.success || false,
            newNextBillingDate: nextBillingUpdateResult?.nextBillingDate,
          });

          successCount++;
        } else {
          writeTextLog(`Failed to create billing attempt for ${contract.id}: ${rebillResult.error}`);
          results.push({
            id: contract.id,
            success: false,
            error: rebillResult.error,
            userErrors: rebillResult.userErrors
          });
          failureCount++;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      afterCursor = pageInfo?.hasNextPage ? pageInfo.endCursor : null;
    } while (afterCursor);

    writeTextLog(`Completed. Total: ${allContracts.length}, Success: ${successCount}, Failures: ${failureCount}`);
    return json(
      {
        message: "Completed",
        totalProcessed: allContracts.length,
        success: successCount,
        failures: failureCount,
        results,
      },
      { status: 200 }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    const errorStack = error instanceof Error ? error.stack : "";
    writeTextLog({
      message: "Processing error",
      error: errorMessage,
      stack: errorStack,
      totalProcessed: allContracts.length,
      successCount,
      failureCount
    });
    console.error("Processing error:", error, errorStack);
    return json(
      {
        error: `Failed to process: ${errorMessage}`,
        totalProcessed: allContracts.length,
        success: successCount,
        failures: failureCount,
        results,
      },
      { status: 500 }
    );
  }
}
