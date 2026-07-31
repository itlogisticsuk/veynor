(function () {
  "use strict";

const state = {
  file: null,
  fileName: "",
  invoiceReference: "",

  importId: null,

  parsedRows: [],
  previewRows: [],
  jobSummaries: []
};

  function byId(id) {
    return document.getElementById(id);
  }

  function analyticsApi() {
    const api = window.VeynorAnalytics;

    if (!api) {
      throw new Error(
        "Veynor Analytics is not available. Load analytics.js before analytics-carrier-import.js."
      );
    }

    return api;
  }

  function toast(message, type = "ok") {
    try {
      analyticsApi().toast(message, type);
    } catch (error) {
      console[type === "err" ? "error" : "log"](message);
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char]));
  }

  function cleanText(value) {
    return String(value ?? "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normal(value) {
    return cleanText(value).toUpperCase();
  }

  function toNumber(value, fallback = 0) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    let text = cleanText(value);

    if (!text) return fallback;

    text = text
      .replace(/[£€$]/g, "")
      .replace(/\s/g, "");

    if (text.includes(",") && text.includes(".")) {
      if (text.lastIndexOf(",") > text.lastIndexOf(".")) {
        text = text.replace(/\./g, "").replace(",", ".");
      } else {
        text = text.replace(/,/g, "");
      }
    } else if (text.includes(",")) {
      text = text.replace(",", ".");
    }

    const number = Number(text);

    return Number.isFinite(number)
      ? number
      : fallback;
  }

  function roundMoney(value) {
    return Number(toNumber(value, 0).toFixed(2));
  }

const FDS_FUEL_SURCHARGE_RATE =
  0.08;

function calculateFdsFuelSurcharge(baseAmount) {
  return roundMoney(
    toNumber(baseAmount, 0) *
    FDS_FUEL_SURCHARGE_RATE
  );
}

function calculateFdsTotalCost(baseAmount) {
  const base =
    roundMoney(baseAmount);

  const fuel =
    calculateFdsFuelSurcharge(base);

  return roundMoney(
    base + fuel
  );
}

  function money(value) {
    return "£" + toNumber(value, 0).toLocaleString("en-GB", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function normaliseHeader(value) {
    return cleanText(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function firstValue(row, aliases) {
    const wanted = aliases.map(normaliseHeader);

    for (const [key, value] of Object.entries(row || {})) {
      if (wanted.includes(normaliseHeader(key))) {
        return value;
      }
    }

    return null;
  }

  function normaliseSo(value) {
    const text = normal(value);

    let match = text.match(/\bSO[\s-]?0*(\d{1,8})\b/);

    if (!match) {
      match = text.match(/(?:^|[^0-9])(\d{5})(?:[^0-9]|$)/);
    }

    if (!match) return "";

    return `SO-${String(match[1]).padStart(5, "0")}`;
  }

  function extractAcknowledgementReferences(value) {
    const text = normal(value);
    const references = [];
    const regex = /\b(ACK|REP|DIS)\s*-?\s*(\d+)\b/g;

    let match;

    while ((match = regex.exec(text)) !== null) {
      references.push(`${match[1]}${match[2]}`);
    }

    return Array.from(new Set(references));
  }

  function normalisePo(value) {
    return normal(value)
      .replace(/\s+/g, "")
      .replace(/[^A-Z0-9/_-]/g, "");
  }

  function orderNumber(order) {
    return (
      order?.order_number ||
      order?.sales_order_number ||
      order?.so_number ||
      ""
    );
  }

  function orderAckValues(order) {
    return [
      order?.ack_number,
      order?.external_reference,
      order?.supplier_order_number,
      order?.acknowledgement_number
    ]
      .flatMap(value => extractAcknowledgementReferences(value))
      .filter(Boolean);
  }

  function orderPoValues(order) {
    return [
      order?.purchase_order,
      order?.po_number,
      order?.customer_purchase_order,
      order?.customer_reference
    ]
      .map(normalisePo)
      .filter(Boolean);
  }

  function retailerName(order) {
    return (
      order?.retail_name ||
      order?.retailer_name ||
      order?.delivery_name ||
      order?.delivery_company ||
      order?.customer_name ||
      "—"
    );
  }

  function buildOrderIndexes(orders) {
    const so = new Map();
    const ack = new Map();
    const po = new Map();

    function add(map, key, order) {
      if (!key) return;

      if (!map.has(key)) {
        map.set(key, []);
      }

      map.get(key).push(order);
    }

    orders.forEach(order => {
      add(
        so,
        normaliseSo(orderNumber(order)),
        order
      );

      orderAckValues(order).forEach(value => {
        add(ack, value, order);
      });

      orderPoValues(order).forEach(value => {
        add(po, value, order);
      });
    });

    return { so, ack, po };
  }

  function matchImportRow(row, indexes) {
    const sourceReference =
      cleanText(row.sourceReference);

    const soReference =
      normaliseSo(sourceReference);

    if (soReference) {
      const matches =
        indexes.so.get(soReference) || [];

      if (matches.length === 1) {
        return {
          order: matches[0],
          method: "Exact SO",
          confidence: 100,
          matchedReference: soReference
        };
      }

      if (matches.length > 1) {
        return {
          order: null,
          method: "Duplicate SO",
          confidence: 0,
          matchedReference: soReference,
          error: "More than one Veynor order has this SO number."
        };
      }
    }

    const acknowledgementReferences =
      extractAcknowledgementReferences(
        sourceReference
      );

    for (const reference of acknowledgementReferences) {
      const matches =
        indexes.ack.get(reference) || [];

      if (matches.length === 1) {
        return {
          order: matches[0],
          method: "Exact ACK",
          confidence: 100,
          matchedReference: reference
        };
      }

      if (matches.length > 1) {
        return {
          order: null,
          method: "Duplicate ACK",
          confidence: 0,
          matchedReference: reference,
          error: "More than one Veynor order has this ACK reference."
        };
      }
    }

    const poCandidates =
      sourceReference
        .split(/[\/|,;]/)
        .map(normalisePo)
        .filter(value =>
          value &&
          !/^(ACK|REP|DIS)\d+$/.test(value) &&
          !/^SO-?\d+$/.test(value)
        );

    for (const reference of poCandidates) {
      const matches =
        indexes.po.get(reference) || [];

      if (matches.length === 1) {
        return {
          order: matches[0],
          method: "Exact PO",
          confidence: 85,
          matchedReference: reference
        };
      }

      if (matches.length > 1) {
        return {
          order: null,
          method: "Duplicate PO",
          confidence: 0,
          matchedReference: reference,
          error: "The PO reference matches more than one Veynor order."
        };
      }
    }

    return {
      order: null,
      method: "No match",
      confidence: 0,
      matchedReference: "",
      error: "No exact SO, ACK or unique PO match found."
    };
  }

  function findHeaderRow(matrix) {
    const limit = Math.min(matrix.length, 25);

    for (let index = 0; index < limit; index += 1) {
      const row = matrix[index] || [];
      const headers = row.map(normaliseHeader);

      const hasJob =
        headers.some(value =>
          ["job ref", "job reference"].includes(value)
        );

      const hasOrder =
        headers.some(value =>
          ["order ref", "order reference"].includes(value)
        );

      const hasPrice =
        headers.some(value =>
          [
            "itemised price",
            "itemized price",
            "price"
          ].includes(value)
        );

      if (hasJob && hasOrder && hasPrice) {
        return index;
      }
    }

    return -1;
  }

  function matrixToObjects(matrix, headerRowIndex) {
    const headers =
      (matrix[headerRowIndex] || []).map((value, index) => {
        const header = cleanText(value);
        return header || `column_${index + 1}`;
      });

    return matrix
      .slice(headerRowIndex + 1)
      .map(values => {
        const row = {};

        headers.forEach((header, index) => {
          row[header] = values?.[index] ?? null;
        });

        return row;
      });
  }

  function isJobReference(value) {
    return /^FDS[\s-]?\d+$/i.test(cleanText(value));
  }

  function normaliseJobReference(value) {
    const text = normal(value)
      .replace(/\s+/g, "")
      .replace("-", "");

    const match = text.match(/^FDS(\d+)$/);

    return match
      ? `FDS${match[1]}`
      : cleanText(value);
  }

function detectCarrierLineType(row) {
  const text = normal(
    [
      row?.sourceReference,
      row?.description,
      ...(row?.descriptions || [])
    ].filter(Boolean).join(" ")
  );

  if (
    text.includes("COLLECTION") ||
    text.includes("COLLECT") ||
    text.includes("PICK UP") ||
    text.includes("PICKUP")
  ) {
    return "collection";
  }

  if (
    normaliseSo(row?.sourceReference) ||
    extractAcknowledgementReferences(
      row?.sourceReference
    ).length
  ) {
    return "order_charge";
  }

  return "other";
}

function normaliseServiceDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return null;
    }

    return value.toISOString().slice(0, 10);
  }

  const text =
    cleanText(value);

  let match =
    text.match(
      /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/
    );

  if (match) {
    return [
      match[3],
      String(match[2]).padStart(2, "0"),
      String(match[1]).padStart(2, "0")
    ].join("-");
  }

  match =
    text.match(
      /^(\d{4})-(\d{2})-(\d{2})$/
    );

  if (match) {
    return text;
  }

  return null;
}

  function parseInvoiceRows(rawRows) {
    const grouped = new Map();
    const jobs = new Map();

    let activeJobRef = "";
    let activeSourceReference = "";

    rawRows.forEach((row, rowIndex) => {
      const rawJobRef =
        firstValue(row, [
          "Job Ref",
          "Job Reference"
        ]);

      const rawOrderRef =
        firstValue(row, [
          "Order Ref",
          "Order Reference"
        ]);

      const rawItemisedPrice =
        firstValue(row, [
          "Itemised Price",
          "Itemized Price",
          "Price"
        ]);

      const rawNet =
        firstValue(row, [
          "Net",
          "Net Amount"
        ]);

      const description =
        cleanText(
          firstValue(row, [
            "Product Description",
            "Description"
          ])
        );

      const postcode =
        cleanText(
          firstValue(row, [
            "Postcode",
            "Post Code"
          ])
        );

const serviceDate =
  normaliseServiceDate(
    firstValue(row, [
      "Date",
      "Service Date",
      "Delivery Date",
      "Collection Date"
    ])
  );

      const jobCandidate =
        cleanText(rawJobRef);

if (jobCandidate && isJobReference(jobCandidate)) {
  const newJobRef =
    normaliseJobReference(jobCandidate);

  if (newJobRef !== activeJobRef) {
    activeSourceReference = "";
  }

  activeJobRef =
    newJobRef;
}

const sourceCandidate =
  cleanText(rawOrderRef);

const sourceCandidateNormal =
  normal(sourceCandidate);

const sourceIsCollection =
  sourceCandidateNormal.includes("COLLECTION") ||
  sourceCandidateNormal.includes("COLLECT") ||
  sourceCandidateNormal.includes("PICK UP") ||
  sourceCandidateNormal.includes("PICKUP");

if (sourceCandidate) {
  activeSourceReference =
    sourceCandidate;
}

/*
 * Een collectionbeschrijving is geen orderreferentie.
 * De tekst blijft wel beschikbaar voor line-type detection,
 * maar wordt niet automatisch gematcht.
 */
if (sourceIsCollection) {
  activeSourceReference =
    sourceCandidate;
}

      if (!activeJobRef) {
        return;
      }

      if (!jobs.has(activeJobRef)) {
        jobs.set(activeJobRef, {
          jobRef: activeJobRef,
          net: null,
          itemisedTotal: 0,
          rows: []
        });
      }

      const job = jobs.get(activeJobRef);

      const net =
        toNumber(rawNet, NaN);

      if (
        Number.isFinite(net) &&
        net >= 0 &&
        job.net === null
      ) {
        job.net = roundMoney(net);
      }

const collectionText =
  normal(
    [
      sourceCandidate,
      description
    ]
      .filter(Boolean)
      .join(" ")
  );

const isCollectionRow =
  collectionText.includes("COLLECTION") ||
  collectionText.includes("COLLECT") ||
  collectionText.includes("PICK UP") ||
  collectionText.includes("PICKUP");

const itemisedPrice =
  toNumber(
    rawItemisedPrice,
    NaN
  );

/*
 * Normale orderregels gebruiken Itemised Price.
 *
 * Collectionregels hebben soms geen Itemised Price,
 * maar alleen een bedrag in de Net-kolom.
 */
let effectivePrice =
  itemisedPrice;

if (
  !Number.isFinite(effectivePrice) &&
  isCollectionRow &&
  Number.isFinite(net)
) {
  effectivePrice =
    net;
}

if (!Number.isFinite(effectivePrice)) {
  return;
}

const price =
  roundMoney(
    effectivePrice
  );

      const key =
        `${activeJobRef}|||${activeSourceReference || "__UNMATCHED__"}`;

      if (!grouped.has(key)) {
grouped.set(key, {
  jobRef:
    activeJobRef,

  sourceReference:
    activeSourceReference,

  description:
    description,

  postcode,
  serviceDate,

  descriptions: [],

  itemisedAmount: 0,
  allocatedDifference: 0,
  finalAmount: 0,

  sourceRows: []
});
      }

      const group =
        grouped.get(key);

      group.itemisedAmount =
        roundMoney(
          group.itemisedAmount +
          price
        );

      group.finalAmount =
        group.itemisedAmount;

      if (description) {
        group.descriptions.push(description);
      }

      group.sourceRows.push(rowIndex + 2);

      job.itemisedTotal =
        roundMoney(
          job.itemisedTotal +
          price
        );

      job.rows.push(group);
    });

    jobs.forEach(job => {
      const uniqueRows =
        Array.from(new Set(job.rows));

      const difference =
        job.net === null
          ? 0
          : roundMoney(
              job.net -
              job.itemisedTotal
            );

      let allocated = 0;

      uniqueRows.forEach((row, index) => {
        const isLast =
          index === uniqueRows.length - 1;

        let share = 0;

        if (difference !== 0) {
          if (isLast) {
            share =
              roundMoney(
                difference -
                allocated
              );
          } else if (job.itemisedTotal > 0) {
            share =
              roundMoney(
                difference *
                (
                  row.itemisedAmount /
                  job.itemisedTotal
                )
              );
          } else {
            share =
              roundMoney(
                difference /
                uniqueRows.length
              );
          }
        }

        allocated =
          roundMoney(
            allocated +
            share
          );

        row.allocatedDifference =
          share;

        row.finalAmount =
          roundMoney(
            row.itemisedAmount +
            share
          );
      });

      job.difference = difference;
      job.rows = uniqueRows;
    });

grouped.forEach(row => {
  row.lineType =
    detectCarrierLineType(row);
});

    return {
      rows: Array.from(grouped.values()),
      jobs: Array.from(jobs.values())
    };
  }

  function buildPreviewRows(parsedRows, orders) {
    const indexes =
      buildOrderIndexes(orders);

    return parsedRows.map(row => {
      const match =
        matchImportRow(row, indexes);

      const existingCost =
        match.order
          ? toNumber(
              match.order.actual_transport_cost_gbp,
              0
            )
          : 0;

      const alreadyConfirmed =
        Boolean(
          match.order?.transport_cost_confirmed_at
        );

      return {
        ...row,
        match,
        orderId:
          match.order?.id || null,
        matchedOrderNumber:
          match.order
            ? orderNumber(match.order)
            : "",
        retailer:
          match.order
            ? retailerName(match.order)
            : "",
        existingCost,
        alreadyConfirmed,
        importable:
          Boolean(match.order)
      };
    });
  }

  function confidencePill(row) {
    if (row.match.confidence >= 100) {
      return `<span class="pill green">100%</span>`;
    }

    if (row.match.confidence >= 80) {
      return `<span class="pill orange">${row.match.confidence}%</span>`;
    }

    return `<span class="pill red">0%</span>`;
  }

  function statusHtml(row) {
    if (!row.importable) {
      return `
        <span class="pill red">Review needed</span>
        <div class="order-cost-order-sub">
          ${escapeHtml(row.match.error || "No match")}
        </div>
      `;
    }

    if (row.alreadyConfirmed) {
      return `
        <span class="pill orange">Will overwrite</span>
        <div class="order-cost-order-sub">
          Existing: ${money(row.existingCost)}
        </div>
      `;
    }

    return `<span class="pill green">Ready</span>`;
  }

function manualOrderOptions() {
  const orders =
    analyticsApi()
      .getOrders()
      .slice()
      .sort((a, b) =>
        String(orderNumber(a)).localeCompare(
          String(orderNumber(b))
        )
      );

  return `
    <option value="">
      Select order
    </option>

    ${orders.map(order => `
      <option value="${escapeHtml(order.id)}">
        ${escapeHtml(orderNumber(order))}
        ·
        ${escapeHtml(retailerName(order))}
      </option>
    `).join("")}
  `;
}

function renderPreview() {
  const preview =
    byId("carrierImportPreview");

  const body =
    byId("carrierImportPreviewBody");

  const summary =
    byId("carrierImportSummary");

  const unprocessedSection =
    byId("carrierImportUnprocessed");

  const unprocessedBody =
    byId("carrierImportUnprocessedBody");

  const unprocessedSummary =
    byId("carrierImportUnprocessedSummary");

  if (
    !preview ||
    !body ||
    !summary ||
    !unprocessedSection ||
    !unprocessedBody ||
    !unprocessedSummary
  ) {
    throw new Error(
      "Carrier import preview elements are missing from analytics.html."
    );
  }

  const readyRows =
    state.previewRows.filter(row =>
      row.importable
    );

  const unprocessedRows =
    state.previewRows.filter(row =>
      !row.importable
    );

  preview.hidden = false;

const confirmButton =
  byId("btnConfirmCarrierImport");

const cancelButton =
  byId("btnCancelCarrierImport");

const hasReadyRows =
  readyRows.length > 0;

if (confirmButton) {
  confirmButton.hidden =
    !hasReadyRows;
}

if (cancelButton) {
  cancelButton.hidden =
    !hasReadyRows;
}

  /*
   * =========================================================
   * READY TO IMPORT
   * =========================================================
   */

  body.innerHTML =
    readyRows.map(row => `
      <tr>
        <td>
          <strong>
            ${escapeHtml(row.jobRef)}
          </strong>
        </td>

        <td>
          ${escapeHtml(
            row.sourceReference || "—"
          )}
        </td>

        <td>
          <strong>
            ${escapeHtml(
              row.matchedOrderNumber
            )}
          </strong>

          <div class="order-cost-order-sub">
            ${escapeHtml(row.retailer)}
          </div>
        </td>

        <td>
          ${escapeHtml(
            row.match.method
          )}

          ${
            row.match.matchedReference
              ? `
                <div class="order-cost-order-sub">
                  ${escapeHtml(
                    row.match.matchedReference
                  )}
                </div>
              `
              : ""
          }
        </td>

        <td>
          ${confidencePill(row)}
        </td>

        <td class="order-cost-money">
          ${money(row.itemisedAmount)}
        </td>

        <td class="order-cost-money">
          ${money(
            row.allocatedDifference
          )}
        </td>

        <td class="order-cost-money">
          <strong>
            ${money(
  calculateFdsTotalCost(
    row.finalAmount
  )
)}
          </strong>
        </td>

        <td>
          ${
            row.alreadyConfirmed
              ? `
                <span class="pill orange">
                  Will overwrite
                </span>

                <div class="order-cost-order-sub">
                  Existing:
                  ${money(row.existingCost)}
                </div>
              `
              : `
                <span class="pill green">
                  Ready
                </span>
              `
          }
        </td>
      </tr>
    `).join("") ||
    `
      <tr>
        <td colspan="9">
          No carrier costs are ready to import.
        </td>
      </tr>
    `;

  /*
   * =========================================================
   * NOT YET PROCESSED
   * =========================================================
   */

  unprocessedBody.innerHTML =
    unprocessedRows.map(row => {
      const lineType =
        row.lineType ||
        detectCarrierLineType(row);

      const isCollection =
        lineType === "collection";

      const description =
        row.description ||
        row.descriptions?.join(" | ") ||
        "";

      return `
        <tr
          data-unprocessed-line="${escapeHtml(
            row.persistedLineId || ""
          )}"
        >
          <td>
            <strong>
              ${escapeHtml(row.jobRef)}
            </strong>
          </td>

          <td>
            <span class="pill ${
              isCollection
                ? "orange"
                : "red"
            }">
              ${
                isCollection
                  ? "Collection"
                  : "Unmatched Charge"
              }
            </span>
          </td>

          <td>
            ${escapeHtml(
              row.sourceReference || "—"
            )}

            ${
              description
                ? `
                  <div class="order-cost-order-sub">
                    ${escapeHtml(description)}
                  </div>
                `
                : ""
            }
          </td>

          <td>
            ${escapeHtml(
              row.postcode || "—"
            )}
          </td>

          <td>
            ${escapeHtml(
              row.serviceDate || "—"
            )}
          </td>

          <td>
            ${
              row.match?.matchedReference
                ? escapeHtml(
                    row.match.matchedReference
                  )
                : "—"
            }
          </td>

          <td>
            <strong>
              ${
                isCollection
                  ? "Collection awaiting allocation"
                  : escapeHtml(
                      row.match?.method ||
                      "No match"
                    )
              }
            </strong>

            <div class="order-cost-order-sub">
              ${
                isCollection
                  ? "Collection cost awaiting manual allocation."
                  : escapeHtml(
                      row.match?.error ||
                      "Manual review is required."
                    )
              }
            </div>
          </td>

          <td class="order-cost-money">
            ${money(row.itemisedAmount)}
          </td>

          <td class="order-cost-money">
            ${money(
              row.allocatedDifference
            )}
          </td>

          <td class="order-cost-money">
            <strong>
              ${money(
  calculateFdsTotalCost(
    row.finalAmount
  )
)}
            </strong>
          </td>

          <td>
            <div class="order-cost-action-group">
              <select
                class="select"
                data-manual-order-select
              >
                ${manualOrderOptions()}
              </select>

              <button
                class="btn btn-primary"
                type="button"
                data-assign-carrier-line
              >
                Assign
              </button>
            </div>
          </td>

          <td>
            <span class="pill red">
              Not Processed
            </span>
          </td>
        </tr>
      `;
    }).join("");

  unprocessedSection.hidden =
    unprocessedRows.length === 0;

  /*
   * =========================================================
   * SUMMARY
   * =========================================================
   */

const readyAmount =
  readyRows.reduce(
    (sum, row) =>
      sum +
      calculateFdsTotalCost(
        row.finalAmount
      ),
    0
  );

const unprocessedAmount =
  unprocessedRows.reduce(
    (sum, row) =>
      sum +
      calculateFdsTotalCost(
        row.finalAmount
      ),
    0
  );

const collectionRows =
  unprocessedRows.filter(row =>
    (
      row.lineType ||
      detectCarrierLineType(row)
    ) === "collection"
  );

const collectionAmount =
  collectionRows.reduce(
    (sum, row) =>
      sum +
      calculateFdsTotalCost(
        row.finalAmount
      ),
    0
  );

const unmatchedRows =
  unprocessedRows.filter(row =>
    (
      row.lineType ||
      detectCarrierLineType(row)
    ) !== "collection"
  );

const unmatchedAmount =
  unmatchedRows.reduce(
    (sum, row) =>
      sum +
      calculateFdsTotalCost(
        row.finalAmount
      ),
    0
  );

  const jobsWithDifference =
    state.jobSummaries.filter(job =>
      Math.abs(
        toNumber(
          job.difference,
          0
        )
      ) >= 0.01
    );

  summary.innerHTML = `
    <div
      class="fds-allocation-summary"
      style="margin-top:12px;"
    >
      <span>
        File:
        <strong>
          ${escapeHtml(state.fileName)}
        </strong>
      </span>

      <span>
        Jobs:
        <strong>
          ${state.jobSummaries.length}
        </strong>
      </span>

      <span>
        Ready:
        <strong>
          ${readyRows.length}
        </strong>
      </span>

      <span>
        Not processed:
        <strong>
          ${unprocessedRows.length}
        </strong>
      </span>

      <span>
        Collections:
        <strong>
          ${collectionRows.length}
        </strong>
      </span>

      <span>
        Ready cost:
        <strong>
          ${money(readyAmount)}
        </strong>
      </span>

      <span>
        Unprocessed cost:
        <strong>
          ${money(unprocessedAmount)}
        </strong>
      </span>

      <span>
        Collection cost:
        <strong>
          ${money(collectionAmount)}
        </strong>
      </span>
    </div>

    ${
      jobsWithDifference.length
        ? `
          <div
            class="order-cost-note"
            style="margin-top:10px;"
          >
            <strong>
              Job-level adjustments allocated:
            </strong>

            ${jobsWithDifference.map(job =>
              `${escapeHtml(job.jobRef)} ${money(job.difference)}`
            ).join(", ")}.

            These adjustments are the difference
            between the FDS Net amount and the
            total Itemised Price.
          </div>
        `
        : ""
    }
  `;

  unprocessedSummary.innerHTML =
    unprocessedRows.length
      ? `
        <strong>
          ${unprocessedRows.length}
          carrier allocation row(s)
        </strong>
        totalling
        <strong>
          ${money(unprocessedAmount)}
        </strong>
        were not imported automatically.

        ${
          collectionRows.length
            ? `
              This includes
              <strong>
                ${collectionRows.length}
                collection row(s)
              </strong>
              totalling
              <strong>
                ${money(collectionAmount)}
              </strong>.
            `
            : ""
        }

        ${
          unmatchedRows.length
            ? `
              The remaining
              <strong>
                ${unmatchedRows.length}
                unmatched charge(s)
              </strong>
              total
              <strong>
                ${money(unmatchedAmount)}
              </strong>.
            `
            : ""
        }
      `
      : "";

  /*
   * Bind de Assign-knoppen nadat de rijen zijn gerenderd.
   */
  bindManualAssignmentActions();

  preview.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function resetImport() {
  state.file = null;
  state.fileName = "";
  state.invoiceReference = "";
  state.importId = null;
  state.parsedRows = [];
  state.previewRows = [];
  state.jobSummaries = [];

    const input =
      byId("carrierInvoiceFileInput");

    const fileName =
      byId("carrierInvoiceFileName");

    const preview =
      byId("carrierImportPreview");

    const body =
      byId("carrierImportPreviewBody");

    const summary =
      byId("carrierImportSummary");

const unprocessedSection =
  byId("carrierImportUnprocessed");

const unprocessedBody =
  byId("carrierImportUnprocessedBody");

const unprocessedSummary =
  byId("carrierImportUnprocessedSummary");

    if (input) input.value = "";

    if (fileName) {
      fileName.textContent =
        "No invoice selected.";
    }

    if (preview) preview.hidden = true;
    if (body) body.innerHTML = "";
    if (summary) summary.innerHTML = "";

if (unprocessedSection) {
  unprocessedSection.hidden = true;
}

if (unprocessedBody) {
  unprocessedBody.innerHTML = "";
}

if (unprocessedSummary) {
  unprocessedSummary.textContent = "";
}
  }

  function deriveInvoiceReference(fileName) {
    return cleanText(fileName)
      .replace(/\.(xlsx|xls)$/i, "")
      .slice(0, 120);
  }

  async function readWorkbook(file) {
    if (typeof XLSX === "undefined") {
      throw new Error(
        "The XLSX library is not loaded."
      );
    }

    const buffer =
      await file.arrayBuffer();

    return XLSX.read(buffer, {
      type: "array",
      cellDates: true,
      raw: true
    });
  }

  function findInvoiceSheet(workbook) {
    let best = null;

    workbook.SheetNames.forEach(sheetName => {
      const sheet =
        workbook.Sheets[sheetName];

      const matrix =
        XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          defval: null,
          raw: true
        });

      const headerRowIndex =
        findHeaderRow(matrix);

      if (headerRowIndex < 0) {
        return;
      }

      const score =
        matrix.length -
        headerRowIndex;

      if (!best || score > best.score) {
        best = {
          sheetName,
          matrix,
          headerRowIndex,
          score
        };
      }
    });

    if (!best) {
      throw new Error(
        "No FDS invoice sheet with Job Ref, Order Ref and Itemised Price columns was found."
      );
    }

    return best;
  }

async function persistCarrierInvoice() {
  const api =
    analyticsApi();

  const db =
    api.getClient();

  const companyId =
    await api.getCompanyId();

  const readyRows =
    state.previewRows.filter(row =>
      row.importable
    );

  const unprocessedRows =
    state.previewRows.filter(row =>
      !row.importable
    );

const totalAmount =
  state.previewRows.reduce(
    (sum, row) =>
      sum +
      calculateFdsTotalCost(
        row.finalAmount
      ),
    0
  );

const matchedAmount =
  readyRows.reduce(
    (sum, row) =>
      sum +
      calculateFdsTotalCost(
        row.finalAmount
      ),
    0
  );

const unmatchedAmount =
  unprocessedRows.reduce(
    (sum, row) =>
      sum +
      calculateFdsTotalCost(
        row.finalAmount
      ),
    0
  );

  const importPayload = {
    company_id:
      companyId,

    file_name:
      state.fileName,

    invoice_reference:
      state.invoiceReference,

    carrier_name:
      "FDS",

    status:
      unprocessedRows.length
        ? "partially_processed"
        : "processing",

    total_lines:
      state.previewRows.length,

    matched_lines:
      readyRows.length,

    unmatched_lines:
      unprocessedRows.length,

    total_amount_gbp:
      roundMoney(totalAmount),

    matched_amount_gbp:
      roundMoney(matchedAmount),

    unmatched_amount_gbp:
      roundMoney(unmatchedAmount)
  };

  const {
    data: importRecord,
    error: importError
  } =
    await db
      .from("carrier_invoice_imports")
      .insert(importPayload)
      .select("id")
      .single();

  if (importError) {
    throw importError;
  }

  state.importId =
    importRecord.id;

  /*
   * Regels afzonderlijk inserten.
   * Hierdoor ontvangen we voor iedere previewregel betrouwbaar
   * het gegenereerde database-ID terug.
   */
  for (const row of state.previewRows) {
    const linePayload = {
      import_id:
        state.importId,

      company_id:
        companyId,

      job_ref:
        row.jobRef || null,

      source_reference:
        row.sourceReference || null,

      line_type:
        row.lineType ||
        detectCarrierLineType(row),

      description:
        row.description ||
        row.descriptions?.join(" | ") ||
        null,

      postcode:
        row.postcode || null,

      service_date:
        row.serviceDate || null,

      matched_order_id:
        row.orderId || null,

      matched_order_number:
        row.matchedOrderNumber || null,

      match_method:
        row.match?.method || null,

      matched_reference:
        row.match?.matchedReference || null,

      confidence:
        toNumber(
          row.match?.confidence,
          0
        ),

base_cost_gbp:
  roundMoney(
    row.finalAmount
  ),

adjustment_gbp:
  roundMoney(
    row.allocatedDifference
  ),

fuel_surcharge_gbp:
  calculateFdsFuelSurcharge(
    row.finalAmount
  ),

total_cost_gbp:
  calculateFdsTotalCost(
    row.finalAmount
  ),

      status:
        row.importable
          ? "ready"
          : "not_processed",

      failure_reason:
        row.importable
          ? null
          : (
              row.match?.error ||
              (
                row.lineType === "collection"
                  ? "Collection cost awaiting manual allocation."
                  : "No automatic order match found."
              )
            )
    };

    const {
      data: insertedLine,
      error: lineError
    } =
      await db
        .from("carrier_invoice_import_lines")
        .insert(linePayload)
        .select("id")
        .single();

    if (lineError) {
      throw lineError;
    }

    row.persistedLineId =
      insertedLine.id;
  }
}

async function loadPendingCarrierLines() {
  const api =
    analyticsApi();

  const db =
    api.getClient();

  const companyId =
    await api.getCompanyId();

  const {
    data,
    error
  } =
    await db
      .from("carrier_invoice_import_lines")
      .select(`
        id,
        import_id,
        company_id,
        job_ref,
        source_reference,
        line_type,
        description,
        postcode,
        service_date,
        matched_order_id,
        matched_order_number,
        match_method,
        matched_reference,
        confidence,
        base_cost_gbp,
        adjustment_gbp,
        fuel_surcharge_gbp,
        total_cost_gbp,
        status,
        failure_reason,
        created_at
      `)
      .eq("company_id", companyId)
      .eq("status", "not_processed")
      .order("created_at", {
        ascending: true
      });

  if (error) {
    throw error;
  }

  const pendingLines =
    Array.isArray(data)
      ? data
      : [];

  /*
   * Zet databasevelden terug om naar hetzelfde formaat
   * dat renderPreview() al gebruikt.
   */
  const restoredRows =
    pendingLines.map(line => {
      const netCost =
        roundMoney(
          toNumber(
            line.base_cost_gbp,
            0
          )
        );

      return {
        persistedLineId:
          line.id,

        importId:
          line.import_id,

        jobRef:
          line.job_ref || "",

        sourceReference:
          line.source_reference || "",

        lineType:
          line.line_type || "other",

        description:
          line.description || "",

        descriptions:
          line.description
            ? [line.description]
            : [],

        postcode:
          line.postcode || "",

        serviceDate:
          line.service_date || null,

        itemisedAmount:
          netCost,

        allocatedDifference:
          roundMoney(
            toNumber(
              line.adjustment_gbp,
              0
            )
          ),

        finalAmount:
          netCost,

        orderId:
          line.matched_order_id || null,

        matchedOrderNumber:
          line.matched_order_number || "",

        retailer:
          "",

        existingCost:
          0,

        alreadyConfirmed:
          false,

        importable:
          false,

        match: {
          order:
            null,

          method:
            line.match_method ||
            (
              line.line_type === "collection"
                ? "Manual allocation required"
                : "No match"
            ),

          confidence:
            toNumber(
              line.confidence,
              0
            ),

          matchedReference:
            line.matched_reference || "",

          error:
            line.failure_reason ||
            (
              line.line_type === "collection"
                ? "Collection cost awaiting manual allocation."
                : "Manual review is required."
            )
        }
      };
    });

  /*
   * Bewaar eventuele actuele uploadregels en voeg alleen
   * nog niet aanwezige database-regels toe.
   */
  const existingIds =
    new Set(
      state.previewRows
        .map(row =>
          String(
            row.persistedLineId || ""
          )
        )
        .filter(Boolean)
    );

  restoredRows.forEach(row => {
    const lineId =
      String(
        row.persistedLineId || ""
      );

    if (
      lineId &&
      !existingIds.has(lineId)
    ) {
      state.previewRows.push(row);
    }
  });

  if (restoredRows.length) {
    renderPreview();
  }
}

  async function handleFile(file) {
    if (!file) return;

    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      throw new Error(
        "Select an Excel file (.xlsx or .xls)."
      );
    }

    const api =
      analyticsApi();

    const orders =
      api.getOrders();

    if (!Array.isArray(orders) || !orders.length) {
      throw new Error(
        "Analytics orders are not loaded yet. Refresh Analytics and try again."
      );
    }

    const workbook =
      await readWorkbook(file);

    const selectedSheet =
      findInvoiceSheet(workbook);

    const rawRows =
      matrixToObjects(
        selectedSheet.matrix,
        selectedSheet.headerRowIndex
      );

    const parsed =
      parseInvoiceRows(rawRows);

    if (!parsed.rows.length) {
      throw new Error(
        "No itemised FDS carrier charges were found in this file."
      );
    }

    state.file = file;
    state.fileName = file.name;
    state.invoiceReference =
      deriveInvoiceReference(file.name);
    state.parsedRows = parsed.rows;
    state.jobSummaries = parsed.jobs;
state.previewRows =
  buildPreviewRows(
    parsed.rows,
    orders
  );

await persistCarrierInvoice();
    const fileNameElement =
      byId("carrierInvoiceFileName");

    if (fileNameElement) {
      fileNameElement.textContent =
        `${file.name} · ${state.previewRows.length} carrier allocation row(s) found`;
    }

    renderPreview();

    toast(
      "FDS invoice read. Review the matches before confirming.",
      "ok"
    );
  }

  function aggregateImportableRows() {
    const map = new Map();

    state.previewRows
      .filter(row => row.importable)
      .forEach(row => {
        const key =
          String(row.orderId);

        if (!map.has(key)) {
          map.set(key, {
            orderId: row.orderId,
            orderNumber:
              row.matchedOrderNumber,
            base: 0,
            adjustment: 0,
            total: 0,
            jobRefs: new Set()
          });
        }

        const aggregate =
          map.get(key);

        aggregate.base =
          roundMoney(
            aggregate.base +
            row.itemisedAmount
          );

        aggregate.adjustment =
          roundMoney(
            aggregate.adjustment +
            row.allocatedDifference
          );

        aggregate.total =
          roundMoney(
            aggregate.total +
            row.finalAmount
          );

        aggregate.jobRefs.add(row.jobRef);
      });

    return Array.from(map.values());
  }

  async function confirmImport() {
    const aggregates =
      aggregateImportableRows();

    if (!aggregates.length) {
      throw new Error(
        "There are no matched carrier costs to import."
      );
    }

    const overwriteCount =
      state.previewRows.filter(row =>
        row.importable &&
        row.alreadyConfirmed
      ).length;

    const message = [
      `Import carrier costs for ${aggregates.length} Veynor order(s)?`,
      "",
      "Only matched rows will be saved.",
      "Unmatched collection or carrier costs will remain excluded."
    ];

    if (overwriteCount > 0) {
      message.push(
        "",
        `${overwriteCount} preview row(s) belong to orders that already have confirmed transport costs.`,
        "Their current order-level transport cost will be replaced by the total from this uploaded file."
      );
    }

    if (!window.confirm(message.join("\n"))) {
      return;
    }

    const api =
      analyticsApi();

    const db =
      api.getClient();

    const companyId =
      await api.getCompanyId();

    const button =
      byId("btnConfirmCarrierImport");

    const oldText =
      button?.textContent || "Confirm Import";

    if (button) {
      button.disabled = true;
      button.textContent =
        "Importing...";
    }

    const confirmedAt =
      new Date().toISOString();

    let imported = 0;
    const failures = [];

    for (const aggregate of aggregates) {
      const jobRefs =
        Array.from(aggregate.jobRefs);

      const referenceParts = [
        state.invoiceReference,
        ...jobRefs
      ].filter(Boolean);

const fdsNetCost =
  roundMoney(
    aggregate.total
  );

const fdsFuelSurcharge =
  calculateFdsFuelSurcharge(
    fdsNetCost
  );

const fdsTotalCost =
  calculateFdsTotalCost(
    fdsNetCost
  );

const payload = {
  actual_transport_cost_gbp:
    fdsTotalCost,

  transport_cost_confirmed_at:
    confirmedAt,

  transport_cost_source:
    "carrier_invoice_import",

  transport_cost_reference:
    referenceParts
      .join(" + ")
      .slice(0, 500),

  transport_type:
    "charter",

  fds_base_cost_gbp:
    fdsNetCost,

  fds_fuel_surcharge_cost_gbp:
    fdsFuelSurcharge,

  fds_total_cost_gbp:
    fdsTotalCost
};

      const { error } =
        await db
          .from("orders")
          .update(payload)
          .eq("id", aggregate.orderId)
          .eq("company_id", companyId);

      if (error) {
        failures.push({
          orderNumber:
            aggregate.orderNumber,
          error:
            error.message
        });

        continue;
      }

const aggregateLineIds =
  state.previewRows
    .filter(row =>
      row.importable &&
      String(row.orderId) ===
      String(aggregate.orderId)
    )
    .map(row =>
      row.persistedLineId
    )
    .filter(Boolean);

if (aggregateLineIds.length) {
  const {
    error: lineStatusError
  } =
    await db
      .from("carrier_invoice_import_lines")
      .update({
        status:
          "processed",

        processed_at:
          confirmedAt,

        failure_reason:
          null
      })
      .in(
        "id",
        aggregateLineIds
      )
      .eq(
        "company_id",
        companyId
      );

  if (lineStatusError) {
    failures.push({
      orderNumber:
        aggregate.orderNumber,

      error:
        lineStatusError.message
    });

    continue;
  }
}

      imported += 1;
    }

    if (failures.length) {
      console.error(
        "[analytics-carrier-import] Import failures",
        failures
      );
    }

if (state.importId) {
  const remainingUnprocessed =
    state.previewRows.filter(row =>
      !row.importable
    );

  const importStatus =
    failures.length
      ? "partially_processed"
      : (
          remainingUnprocessed.length
            ? "partially_processed"
            : "processed"
        );

  const {
    error: importStatusError
  } =
    await db
      .from("carrier_invoice_imports")
      .update({
        status:
          importStatus,

        matched_lines:
          state.previewRows.filter(row =>
            row.importable
          ).length,

        unmatched_lines:
          remainingUnprocessed.length,

matched_amount_gbp:
  roundMoney(
    state.previewRows
      .filter(row =>
        row.importable
      )
      .reduce(
        (sum, row) =>
          sum +
          calculateFdsTotalCost(
            row.finalAmount
          ),
        0
      )
  ),

unmatched_amount_gbp:
  roundMoney(
    remainingUnprocessed.reduce(
      (sum, row) =>
        sum +
        calculateFdsTotalCost(
          row.finalAmount
        ),
      0
    )
  )
      })
      .eq("id", state.importId)
      .eq("company_id", companyId);

  if (importStatusError) {
    console.error(
      "[analytics-carrier-import] Import status update failed",
      importStatusError
    );
  }
}

    await api.refresh();

    if (failures.length) {
      toast(
        `${imported} order(s) imported; ${failures.length} failed. Check the console for details.`,
        "err"
      );
    } else {
      toast(
        `${imported} carrier order(s) imported and confirmed.`,
        "ok"
      );
    }

    resetImport();

    if (button) {
      button.disabled = false;
      button.textContent =
        oldText;
    }
  }

function bindManualAssignmentActions() {
  document
    .querySelectorAll(
      "[data-assign-carrier-line]"
    )
    .forEach(button => {
      button.addEventListener(
        "click",
        async () => {
          const rowElement =
            button.closest(
              "[data-unprocessed-line]"
            );

          const lineId =
            rowElement?.dataset
              .unprocessedLine;

          const select =
            rowElement?.querySelector(
              "[data-manual-order-select]"
            );

          const orderId =
            select?.value || "";

          if (!lineId) {
            toast(
              "The carrier line has not been saved.",
              "err"
            );

            return;
          }

          if (!orderId) {
            toast(
              "Select an order first.",
              "err"
            );

            return;
          }

          const previewRow =
            state.previewRows.find(row =>
              String(row.persistedLineId) ===
              String(lineId)
            );

          const order =
            analyticsApi()
              .getOrders()
              .find(item =>
                String(item.id) ===
                String(orderId)
              );

          if (!previewRow || !order) {
            toast(
              "The carrier line or selected order could not be found.",
              "err"
            );

            return;
          }

          button.disabled = true;
          button.textContent =
            "Assigning...";

          try {
            const api =
              analyticsApi();

            const db =
              api.getClient();

            const companyId =
              await api.getCompanyId();

            const existingTotal =
              toNumber(
                order.actual_transport_cost_gbp,
                0
              );

            const existingBase =
              toNumber(
                order.fds_base_cost_gbp,
                0
              );

const existingFuelSurcharge =
  toNumber(
    order.fds_fuel_surcharge_cost_gbp,
    0
  );

const assignedNetCost =
  roundMoney(
    previewRow.finalAmount
  );

const assignedFuelSurcharge =
  calculateFdsFuelSurcharge(
    assignedNetCost
  );

const assignedTotalCost =
  calculateFdsTotalCost(
    assignedNetCost
  );

const newBase =
  roundMoney(
    existingBase +
    assignedNetCost
  );

const newFuelSurcharge =
  roundMoney(
    existingFuelSurcharge +
    assignedFuelSurcharge
  );

const newTotal =
  roundMoney(
    existingTotal +
    assignedTotalCost
  );

            const existingReference =
              cleanText(
                order.transport_cost_reference
              );

            const newReference =
              [
                existingReference,
                previewRow.jobRef,
                previewRow.lineType === "collection"
                  ? "Collection"
                  : ""
              ]
                .filter(Boolean)
                .join(" + ")
                .slice(0, 500);

            const {
              error: orderError
            } =
              await db
                .from("orders")
                .update({
                  actual_transport_cost_gbp:
                    newTotal,

                  transport_cost_confirmed_at:
                    new Date().toISOString(),

                  transport_cost_source:
                    "carrier_invoice_manual_assignment",

                  transport_cost_reference:
                    newReference,

                  transport_type:
                    "charter",

                  fds_base_cost_gbp:
                    newBase,

 fds_fuel_surcharge_cost_gbp:
  newFuelSurcharge,

                  fds_total_cost_gbp:
                    newTotal
                })
                .eq("id", orderId)
                .eq("company_id", companyId);

            if (orderError) {
              throw orderError;
            }

            const {
              error: lineError
            } =
              await db
                .from(
                  "carrier_invoice_import_lines"
                )
                .update({
                  matched_order_id:
                    orderId,

                  matched_order_number:
                    orderNumber(order),

                  match_method:
                    "Manual assignment",

                  matched_reference:
                    orderNumber(order),

                  confidence:
                    100,

                  status:
                    "processed",

                  manually_assigned_at:
                    new Date().toISOString(),

                  processed_at:
                    new Date().toISOString(),

                  failure_reason:
                    null
                })
                .eq("id", lineId)
                .eq("company_id", companyId)
                .eq("status", "not_processed");

            if (lineError) {
              throw lineError;
            }

state.previewRows =
  state.previewRows.filter(row =>
    String(row.persistedLineId) !==
    String(lineId)
  );

await api.refresh();

await loadPendingCarrierLines();

if (
  state.previewRows.length
) {
  renderPreview();
} else {
  const preview =
    byId("carrierImportPreview");

  if (preview) {
    preview.hidden = true;
  }
}

toast(
  `${money(
    calculateFdsTotalCost(
      previewRow.finalAmount
    )
  )} assigned to ${orderNumber(order)}.`,
  "ok"
);
          } catch (error) {
            console.error(error);

            button.disabled = false;
            button.textContent =
              "Assign";

            toast(
              error.message ||
              "The carrier cost could not be assigned.",
              "err"
            );
          }
        }
      );
    });
}

  function bindActions() {
    const selectButton =
      byId("btnSelectCarrierInvoice");

    const input =
      byId("carrierInvoiceFileInput");

    const cancelButton =
      byId("btnCancelCarrierImport");

    const confirmButton =
      byId("btnConfirmCarrierImport");

    if (
      !selectButton ||
      !input ||
      !cancelButton ||
      !confirmButton
    ) {
      console.warn(
        "[analytics-carrier-import] Carrier import HTML elements were not found."
      );

      return;
    }

    selectButton.addEventListener(
      "click",
      () => {
        input.click();
      }
    );

    input.addEventListener(
      "change",
      async () => {
        const file =
          input.files?.[0];

        if (!file) return;

        selectButton.disabled = true;

        const oldText =
          selectButton.textContent;

        selectButton.textContent =
          "Reading...";

        try {
          await handleFile(file);
        } catch (error) {
          console.error(error);

          resetImport();

          toast(
            error.message ||
            "The FDS invoice could not be read.",
            "err"
          );
        } finally {
          selectButton.disabled = false;
          selectButton.textContent =
            oldText;
        }
      }
    );

    cancelButton.addEventListener(
      "click",
      resetImport
    );

    confirmButton.addEventListener(
      "click",
      async () => {
        try {
          await confirmImport();
        } catch (error) {
          console.error(error);

          confirmButton.disabled = false;
          confirmButton.textContent =
            "Confirm Import";

          toast(
            error.message ||
            "The carrier invoice could not be imported.",
            "err"
          );
        }
      }
    );
  }

async function init() {
  try {
    analyticsApi();

    bindActions();

resetImport();

await loadPendingCarrierLines();

    await loadPendingCarrierLines();
  } catch (error) {
    console.error(
      "[analytics-carrier-import]",
      error
    );

    toast(
      error.message ||
      "Open carrier allocations could not be loaded.",
      "err"
    );
  }
}

  document.addEventListener(
    "DOMContentLoaded",
    init
  );
})();