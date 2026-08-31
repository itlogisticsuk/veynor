(function () {
  "use strict";


  // ==========================================================
  // CONFIGURATION
  // ==========================================================

  const STORAGE_RATE_PER_M3_WEEK =
    1.20;

  const GRACE_MONTHS =
    4;

  const FORECAST_WEEKS =
    8;

  const DEFAULT_VAT_RATE =
    0.20;

  const PAGE_SIZE =
    1000;


  // ==========================================================
  // STATE
  // ==========================================================

  let db = null;

  let currentProfile = null;
  let companyId = null;

  let allItems = [];
  let allCustomers = [];
  let allWarehouses = [];
  let allLocations = [];

  let existingChargePeriods = [];

  let currentCalculation = null;

  let activeTab =
    "toInvoice";

  let selectedForecastWeek =
    null;


  // ==========================================================
  // DOM
  // ==========================================================

  const els = {};


  function cacheElements() {

    els.notice =
      document.getElementById(
        "storageNotice"
      );


    // --------------------------------------------------------
    // FILTERS
    // --------------------------------------------------------

    els.customerFilter =
      document.getElementById(
        "storageCustomerFilter"
      );

    els.skuFilter =
      document.getElementById(
        "storageSkuFilter"
      );

    els.barnFilter =
      document.getElementById(
        "storageBarnFilter"
      );

    els.viewDate =
      document.getElementById(
        "storageViewDate"
      );


    // --------------------------------------------------------
    // BUTTONS
    // --------------------------------------------------------

    els.refreshBtn =
      document.getElementById(
        "storageRefreshBtn"
      );

    els.exportBtn =
      document.getElementById(
        "storageExportBtn"
      );

    els.generateInvoiceBtn =
      document.getElementById(
        "storageGenerateInvoiceBtn"
      );


    // --------------------------------------------------------
    // KPI
    // --------------------------------------------------------

    els.kpiChargeableVolume =
      document.getElementById(
        "kpiChargeableVolume"
      );

    els.kpiChargeablePackages =
      document.getElementById(
        "kpiChargeablePackages"
      );

    els.kpiWeeklyCharge =
      document.getElementById(
        "kpiWeeklyCharge"
      );

    els.kpiAmountDue =
      document.getElementById(
        "kpiAmountDue"
      );

    els.kpiNextIncrease =
      document.getElementById(
        "kpiNextIncrease"
      );

    els.kpiNextIncreaseNote =
      document.getElementById(
        "kpiNextIncreaseNote"
      );


    // --------------------------------------------------------
    // SUMMARY
    // --------------------------------------------------------

    els.summarySubtotal =
      document.getElementById(
        "summarySubtotal"
      );

    els.summaryVat =
      document.getElementById(
        "summaryVat"
      );

    els.summaryVatLabel =
      document.getElementById(
        "summaryVatLabel"
      );

    els.summaryTotal =
      document.getElementById(
        "summaryTotal"
      );

    els.invoiceStatusBadge =
      document.getElementById(
        "storageInvoiceStatusBadge"
      );


    // --------------------------------------------------------
    // FORECAST
    // --------------------------------------------------------

    els.forecastWeeks =
      document.getElementById(
        "storageForecastWeeks"
      );

    els.forecastDetailPanel =
      document.getElementById(
        "forecastDetailPanel"
      );

    els.forecastDetailTitle =
      document.getElementById(
        "forecastDetailTitle"
      );

    els.forecastDetailBody =
      document.getElementById(
        "forecastDetailBody"
      );

    els.forecastDetailCloseBtn =
      document.getElementById(
        "forecastDetailCloseBtn"
      );


    // --------------------------------------------------------
    // TO INVOICE
    // --------------------------------------------------------

    els.invoiceTableBody =
      document.getElementById(
        "storageInvoiceTableBody"
      );

    els.invoiceDetailPanel =
      document.getElementById(
        "storageInvoiceDetailPanel"
      );

    els.invoiceDetailTitle =
      document.getElementById(
        "storageInvoiceDetailTitle"
      );

    els.invoiceDetailBody =
      document.getElementById(
        "storageInvoiceDetailBody"
      );

    els.invoiceDetailCloseBtn =
      document.getElementById(
        "storageInvoiceDetailCloseBtn"
      );


    // --------------------------------------------------------
    // UPCOMING / HISTORY
    // --------------------------------------------------------

    els.upcomingTableBody =
      document.getElementById(
        "storageUpcomingTableBody"
      );

    els.historyTableBody =
      document.getElementById(
        "storageHistoryTableBody"
      );
  }


  // ==========================================================
  // BASIC HELPERS
  // ==========================================================

  function normalize(value) {
    return String(
      value ?? ""
    )
      .trim()
      .toLowerCase();
  }


  function clean(value) {
    return String(
      value ?? ""
    )
      .replace(
        /\s+/g,
        " "
      )
      .trim();
  }


  function toNumber(
    value,
    fallback = 0
  ) {
    const number =
      Number(
        String(
          value ?? ""
        )
          .replace(
            ",",
            "."
          )
      );

    return Number.isFinite(
      number
    )
      ? number
      : fallback;
  }


  function round2(value) {
    return Number(
      toNumber(
        value,
        0
      )
        .toFixed(
          2
        )
    );
  }


  function round3(value) {
    return Number(
      toNumber(
        value,
        0
      )
        .toFixed(
          3
        )
    );
  }


  function escapeHtml(value) {
    return String(
      value ?? ""
    )
      .replace(
        /&/g,
        "&amp;"
      )
      .replace(
        /</g,
        "&lt;"
      )
      .replace(
        />/g,
        "&gt;"
      )
      .replace(
        /"/g,
        "&quot;"
      )
      .replace(
        /'/g,
        "&#039;"
      );
  }


  function formatMoney(value) {
    return `£${toNumber(
      value,
      0
    ).toLocaleString(
      "en-GB",
      {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }
    )}`;
  }


  function formatVolume(value) {
    return `${toNumber(
      value,
      0
    ).toLocaleString(
      "en-GB",
      {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3
      }
    )} m³`;
  }


  function formatDate(value) {

    const date =
      toDate(
        value
      );

    if (!date) {
      return "—";
    }

    return date.toLocaleDateString(
      "en-GB",
      {
        day: "2-digit",
        month: "short",
        year: "numeric"
      }
    );
  }


  function dateKey(value) {

    const date =
      toDate(
        value
      );

    if (!date) {
      return "";
    }

    return [
      date.getFullYear(),
      String(
        date.getMonth() + 1
      ).padStart(
        2,
        "0"
      ),
      String(
        date.getDate()
      ).padStart(
        2,
        "0"
      )
    ].join(
      "-"
    );
  }


  function toDate(value) {

    if (!value) {
      return null;
    }

    if (
      value instanceof Date
    ) {
      if (
        Number.isNaN(
          value.getTime()
        )
      ) {
        return null;
      }

      return new Date(
        value.getFullYear(),
        value.getMonth(),
        value.getDate()
      );
    }

    const raw =
      String(
        value
      );

    /*
     * Date-only waardes expliciet lokaal behandelen.
     */
    if (
      /^\d{4}-\d{2}-\d{2}$/.test(
        raw
      )
    ) {
      const [
        year,
        month,
        day
      ] =
        raw
          .split(
            "-"
          )
          .map(
            Number
          );

      return new Date(
        year,
        month - 1,
        day
      );
    }

    const parsed =
      new Date(
        raw
      );

    if (
      Number.isNaN(
        parsed.getTime()
      )
    ) {
      return null;
    }

    return new Date(
      parsed.getFullYear(),
      parsed.getMonth(),
      parsed.getDate()
    );
  }


  function addDays(
    value,
    days
  ) {

    const date =
      toDate(
        value
      );

    if (!date) {
      return null;
    }

    const result =
      new Date(
        date
      );

    result.setDate(
      result.getDate() +
      Number(
        days || 0
      )
    );

    return result;
  }


  function addMonths(
    value,
    months
  ) {

    const date =
      toDate(
        value
      );

    if (!date) {
      return null;
    }

    const originalDay =
      date.getDate();

    const result =
      new Date(
        date.getFullYear(),
        date.getMonth(),
        1
      );

    result.setMonth(
      result.getMonth() +
      Number(
        months || 0
      )
    );

    /*
     * Zorgt ervoor dat bijvoorbeeld:
     *
     * 31 januari + 1 maand
     * correct naar de laatste dag van februari gaat.
     */
    const lastDay =
      new Date(
        result.getFullYear(),
        result.getMonth() + 1,
        0
      )
        .getDate();

    result.setDate(
      Math.min(
        originalDay,
        lastDay
      )
    );

    return result;
  }


  function daysBetween(
    start,
    end
  ) {

    const a =
      toDate(
        start
      );

    const b =
      toDate(
        end
      );

    if (
      !a ||
      !b
    ) {
      return 0;
    }

    return Math.floor(
      (
        b.getTime() -
        a.getTime()
      ) /
      86400000
    );
  }


  function minDate(...values) {

    const dates =
      values
        .map(
          toDate
        )
        .filter(
          Boolean
        );

    if (
      !dates.length
    ) {
      return null;
    }

    return dates.reduce(
      (
        smallest,
        value
      ) =>
        value < smallest
          ? value
          : smallest
    );
  }


  // ==========================================================
  // UI HELPERS
  // ==========================================================

  function showNotice(
    message,
    type = "ok"
  ) {

    if (!els.notice) {
      return;
    }

    els.notice.className =
      `notice ${type}`;

    els.notice.textContent =
      message;
  }


  function clearNotice() {

    if (!els.notice) {
      return;
    }

    els.notice.className =
      "notice";

    els.notice.textContent =
      "";
  }


  function setBusy(value) {

    document.body.classList.toggle(
      "storage-calculating",
      Boolean(
        value
      )
    );

    if (
      els.refreshBtn
    ) {
      els.refreshBtn.disabled =
        Boolean(
          value
        );
    }
  }


  // ==========================================================
  // SUPABASE / PROFILE
  // ==========================================================

  function getClient() {

    if (
      typeof window.sb !==
      "function"
    ) {
      throw new Error(
        "Supabase client is not available."
      );
    }

    return window.sb();
  }


  async function loadCurrentProfile() {

    const {
      data: userData,
      error: authError
    } =
      await db.auth.getUser();


    if (authError) {
      throw authError;
    }


    const userId =
      userData
        ?.user
        ?.id;


    if (!userId) {
      throw new Error(
        "No signed-in user found."
      );
    }


    let result =
      await db
        .from(
          "user_profiles"
        )
        .select(`
          *,
          companies (
            id,
            name
          ),
          customers (
            id,
            name,
            customer_code
          )
        `)
        .eq(
          "id",
          userId
        )
        .eq(
          "is_active",
          true
        )
        .maybeSingle();


    if (
      !result.data &&
      !result.error
    ) {
      result =
        await db
          .from(
            "user_profiles"
          )
          .select(`
            *,
            companies (
              id,
              name
            ),
            customers (
              id,
              name,
              customer_code
            )
          `)
          .eq(
            "auth_user_id",
            userId
          )
          .eq(
            "is_active",
            true
          )
          .maybeSingle();
    }


    if (result.error) {
      throw result.error;
    }


    if (!result.data) {
      throw new Error(
        "User profile could not be found."
      );
    }


    currentProfile =
      result.data;


    companyId =
      currentProfile.company_id ||
      currentProfile.companies?.id;


    if (!companyId) {
      throw new Error(
        "Company ID could not be resolved."
      );
    }
  }


  // ==========================================================
  // LOAD MASTER DATA
  // ==========================================================

  async function loadCustomers() {

    const {
      data,
      error
    } =
      await db
        .from(
          "customers"
        )
        .select(`
          id,
          name,
          customer_code
        `)
        .eq(
          "company_id",
          companyId
        )
        .order(
          "name"
        );


    if (error) {
      throw error;
    }


    allCustomers =
      data || [];
  }


  async function loadWarehouses() {

    const {
      data,
      error
    } =
      await db
        .from(
          "warehouses"
        )
        .select(`
          id,
          name
        `)
        .eq(
          "company_id",
          companyId
        )
        .order(
          "name"
        );


    if (error) {
      throw error;
    }


    allWarehouses =
      data || [];
  }


  async function loadLocations() {

    const {
      data,
      error
    } =
      await db
        .from(
          "warehouse_locations"
        )
        .select(`
          id,
          warehouse_id,
          code
        `)
        .eq(
          "company_id",
          companyId
        );


    if (error) {

      /*
       * Sommige oudere schemas hebben geen company_id
       * op warehouse_locations.
       */
      const fallback =
        await db
          .from(
            "warehouse_locations"
          )
          .select(`
            id,
            warehouse_id,
            code
          `);


      if (fallback.error) {
        throw fallback.error;
      }


      allLocations =
        fallback.data ||
        [];

      return;
    }


    allLocations =
      data || [];
  }


  // ==========================================================
  // LOAD ALL ITEMS
  // ==========================================================

  async function loadAllItems() {

    let from =
      0;

    const result =
      [];


    while (true) {

      const {
        data,
        error
      } =
        await db
          .from(
            "items"
          )
          .select(`
            id,
            company_id,
            product_id,
            warehouse_id,
            location_id,

            sku_unique,

            inbound_reference,
            inbound_date,
            received_at,
            created_at,

            status,

            linked_order_id,

            reserved_at,
            picked_at,
            loaded_at,
            shipped_at,

            volume_m3,

            package_no,
            package_total,

            is_match_blocked,
            package_condition,

            products (
              id,
              sku_base,
              name,
              description,
              customer_id,
              volume_m3,
              customers (
                id,
                name,
                customer_code
              )
            )
          `)
          .eq(
            "company_id",
            companyId
          )
          .order(
            "created_at",
            {
              ascending: true
            }
          )
          .range(
            from,
            from +
            PAGE_SIZE -
            1
          );


      if (error) {
        throw error;
      }


      const rows =
        data || [];


      result.push(
        ...rows
      );


      if (
        rows.length <
        PAGE_SIZE
      ) {
        break;
      }


      from +=
        PAGE_SIZE;
    }


    allItems =
      result.map(
        decorateItem
      );


    console.log(
      "Storage invoicing items loaded:",
      allItems.length
    );
  }


  function decorateItem(item) {

    const packageTotal =
      Math.max(
        1,
        toNumber(
          item.package_total,
          1
        )
      );


    const productVolume =
      toNumber(
        item.products
          ?.volume_m3,
        0
      );


    const itemVolume =
      toNumber(
        item.volume_m3,
        0
      ) ||
      (
        productVolume /
        packageTotal
      );


    const inboundDate =
      toDate(
        item.inbound_date ||
        item.received_at ||
        item.created_at
      );


    const graceEnd =
      addMonths(
        inboundDate,
        GRACE_MONTHS
      );


    return {
      ...item,

      sku_base:
        clean(
          item.products
            ?.sku_base ||
          ""
        ),

      product_name:
        clean(
          item.products
            ?.name ||
          ""
        ),

      customer_id:
        item.products
          ?.customer_id ||
        "",

      customer_name:
        clean(
          item.products
            ?.customers
            ?.name ||
          ""
        ),

      customer_code:
        clean(
          item.products
            ?.customers
            ?.customer_code ||
          ""
        ),

      package_no:
        Math.max(
          1,
          toNumber(
            item.package_no,
            1
          )
        ),

      package_total:
        packageTotal,

      volume_m3:
        round3(
          itemVolume
        ),

      inboundDate,

      graceEnd,

      warehouse_name:
        getWarehouseName(
          item.warehouse_id
        ),

      location_code:
        getLocationCode(
          item.location_id
        )
    };
  }


  function getWarehouseName(
    warehouseId
  ) {

    return (
      allWarehouses.find(
        warehouse =>
          String(
            warehouse.id
          ) ===
          String(
            warehouseId
          )
      )
        ?.name ||
      ""
    );
  }


  function getLocationCode(
    locationId
  ) {

    return (
      allLocations.find(
        location =>
          String(
            location.id
          ) ===
          String(
            locationId
          )
      )
        ?.code ||
      ""
    );
  }


  // ==========================================================
  // LOAD EXISTING STORAGE PERIODS
  // ==========================================================

  async function loadExistingChargePeriods() {

    let from =
      0;

    const result =
      [];


    while (true) {

      const {
        data,
        error
      } =
        await db
          .from(
            "storage_charge_periods"
          )
          .select(`
            id,
            company_id,
            customer_id,
            invoice_id,
            item_id,
            product_id,
            sku_base,
            package_no,
            package_total,
            inbound_date,
            grace_period_end,
            period_start,
            period_end,
            volume_m3,
            rate_per_m3_week,
            amount_ex_vat,
            status,
            created_at
          `)
          .eq(
            "company_id",
            companyId
          )
          .in(
            "status",
            [
              "pending",
              "invoiced"
            ]
          )
          .range(
            from,
            from +
            PAGE_SIZE -
            1
          );


      if (error) {
        throw error;
      }


      const rows =
        data || [];


      result.push(
        ...rows
      );


      if (
        rows.length <
        PAGE_SIZE
      ) {
        break;
      }


      from +=
        PAGE_SIZE;
    }


    existingChargePeriods =
      result;
  }


  // ==========================================================
  // CHARGEABLE LOGIC
  // ==========================================================

  /*
   * Wanneer stopt het item vrije voorraad te zijn?
   *
   * De eerste operationele gebeurtenis is leidend:
   *
   * reserved
   * picked
   * loaded
   * shipped
   *
   * Hierdoor kunnen bij de eerste storage invoice ook
   * historische, reeds verstreken vrije weken nog worden
   * meegenomen.
   */
  function getFreeStockEndDate(
    item,
    asAtDate
  ) {

    const operationalEnd =
      minDate(
        item.reserved_at,
        item.picked_at,
        item.loaded_at,
        item.shipped_at
      );


    if (
      operationalEnd &&
      operationalEnd <
      asAtDate
    ) {
      return operationalEnd;
    }


    /*
     * Als het item niet meer in_stock is maar er ontbreekt
     * een timestamp, stoppen we conservatief op vandaag.
     */
    if (
      normalize(
        item.status
      ) !==
      "in_stock" &&
      operationalEnd
    ) {
      return operationalEnd;
    }


    return asAtDate;
  }


  /*
   * Vrije voorraad OP DIT MOMENT.
   *
   * Dit gebruiken we voor:
   *
   * - current weekly charge
   * - forecast
   *
   * Blocked stock telt bewust nog mee:
   * het is fysiek aanwezig en niet gereserveerd.
   */
  function isCurrentlyFreeStock(
    item
  ) {

    return (
      normalize(
        item.status
      ) ===
        "in_stock" &&

      !item.linked_order_id &&

      !item.reserved_at
    );
  }


function buildCompletedPeriods(
  item,
  asAtDate
) {

  const periods =
    [];


  if (
    !item.inboundDate ||
    !item.graceEnd
  ) {
    return periods;
  }


  const freeEnd =
    getFreeStockEndDate(
      item,
      asAtDate
    );


  if (
    !freeEnd ||
    freeEnd <=
      item.graceEnd
  ) {
    return periods;
  }


  let periodStart =
    new Date(
      item.graceEnd
    );


  while (true) {

    const periodEnd =
      addDays(
        periodStart,
        7
      );


    /*
     * Alleen volledig verstreken weken.
     */
    if (
      !periodEnd ||
      periodEnd >
        freeEnd
    ) {
      break;
    }


    /*
     * BELANGRIJK:
     *
     * Niet op 2 decimalen afronden per package/week.
     *
     * Voorbeeld:
     *
     * 0.540 × £1.20 = £0.648
     *
     * Dat moet intern £0.648 blijven.
     *
     * Pas wanneer de volledige factuurregel wordt berekend
     * ronden we af op 2 decimalen.
     */
    const rawAmount =
      Number(
        (
          toNumber(
            item.volume_m3,
            0
          ) *
          STORAGE_RATE_PER_M3_WEEK
        ).toFixed(
          6
        )
      );


    periods.push({

      item_id:
        item.id,

      product_id:
        item.product_id,

      customer_id:
        item.customer_id,

      sku_base:
        item.sku_base,

      package_no:
        item.package_no,

      package_total:
        item.package_total,

      inbound_date:
        dateKey(
          item.inboundDate
        ),

      grace_period_end:
        dateKey(
          item.graceEnd
        ),

      period_start:
        dateKey(
          periodStart
        ),

      period_end:
        dateKey(
          periodEnd
        ),

      volume_m3:
        item.volume_m3,

      rate_per_m3_week:
        STORAGE_RATE_PER_M3_WEEK,

      /*
       * NIET round2()
       */
      amount_ex_vat:
        rawAmount,

      item
    });


    periodStart =
      periodEnd;
  }


  return periods;
}

  function periodIdentity(
    period
  ) {

    return [
      period.item_id,
      period.period_start,
      period.period_end
    ].join(
      "|"
    );
  }


  function buildExistingPeriodSet() {

    return new Set(
      existingChargePeriods.map(
        period =>
          periodIdentity(
            period
          )
      )
    );
  }


  // ==========================================================
  // FILTERS
  // ==========================================================

  function getSelectedViewDate() {

    const value =
      els.viewDate
        ?.value;


    const parsed =
      toDate(
        value
      );


    return (
      parsed ||
      toDate(
        new Date()
      )
    );
  }


  function itemPassesFilters(
    item
  ) {

    const customer =
      els.customerFilter
        ?.value ||
      "";


    const skuSearch =
      normalize(
        els.skuFilter
          ?.value
      );


    const barn =
      els.barnFilter
        ?.value ||
      "";


    if (
      customer &&
      String(
        item.customer_id
      ) !==
      String(
        customer
      )
    ) {
      return false;
    }


    if (
      barn &&
      String(
        item.warehouse_id
      ) !==
      String(
        barn
      )
    ) {
      return false;
    }


    if (
      skuSearch
    ) {

      const haystack =
        normalize(
          [
            item.sku_base,
            item.product_name,
            item.sku_unique
          ].join(
            " "
          )
        );


      if (
        !haystack.includes(
          skuSearch
        )
      ) {
        return false;
      }
    }


    return true;
  }


  // ==========================================================
  // MAIN CALCULATION
  // ==========================================================

  function calculateStorage() {

    const asAtDate =
      getSelectedViewDate();


    const existingSet =
      buildExistingPeriodSet();


    const filteredItems =
      allItems.filter(
        itemPassesFilters
      );


    const allCompletedPeriods =
      [];


    filteredItems.forEach(
      item => {

        const periods =
          buildCompletedPeriods(
            item,
            asAtDate
          );


        allCompletedPeriods.push(
          ...periods
        );
      }
    );


    const uninvoicedPeriods =
      allCompletedPeriods.filter(
        period =>
          !existingSet.has(
            periodIdentity(
              period
            )
          )
      );


    /*
     * Current weekly charge =
     * huidige vrije voorraad die inmiddels ouder dan 4 maanden is.
     */
    const currentChargeableItems =
      filteredItems.filter(
        item =>
          isCurrentlyFreeStock(
            item
          ) &&
          item.graceEnd &&
          item.graceEnd <
            asAtDate
      );


    const currentChargeableVolume =
      round3(
        currentChargeableItems.reduce(
          (
            sum,
            item
          ) =>
            sum +
            item.volume_m3,
          0
        )
      );


    const currentWeeklyCharge =
      round2(
        currentChargeableVolume *
        STORAGE_RATE_PER_M3_WEEK
      );


    const amountDue =
      round2(
        uninvoicedPeriods.reduce(
          (
            sum,
            period
          ) =>
            sum +
            period.amount_ex_vat,
          0
        )
      );


    const groupedInvoiceLines =
      groupInvoicePeriods(
        uninvoicedPeriods
      );


    const forecast =
      calculateForecast(
        filteredItems,
        asAtDate
      );


    const upcoming =
      calculateUpcoming(
        filteredItems,
        asAtDate
      );


    currentCalculation = {
      asAtDate,
      filteredItems,
      allCompletedPeriods,
      uninvoicedPeriods,
      groupedInvoiceLines,
      currentChargeableItems,
      currentChargeableVolume,
      currentWeeklyCharge,
      amountDue,
      forecast,
      upcoming
    };


    renderCalculation();
  }


  // ==========================================================
  // GROUP CURRENT INVOICE
  // ==========================================================

  function groupInvoicePeriods(
    periods
  ) {

    const groups =
      new Map();


    periods.forEach(
      period => {

        /*
         * SKU + inbound batch + grace date.
         *
         * Packages met dezelfde SKU/inboundperiode worden
         * op één factuurregel samengevat.
         */
        const key =
          [
            period.customer_id,
            period.sku_base,
            period.inbound_date,
            period.grace_period_end
          ].join(
            "|"
          );


        if (
          !groups.has(
            key
          )
        ) {

          groups.set(
            key,
            {
              key,

              customer_id:
                period.customer_id,

              customer_name:
                period.item
                  ?.customer_name ||
                "",

              sku_base:
                period.sku_base,

              product_name:
                period.item
                  ?.product_name ||
                "",

              inbound_date:
                period.inbound_date,

              grace_period_end:
                period.grace_period_end,

              periods:
                [],

              itemMap:
                new Map()
            }
          );
        }


        const group =
          groups.get(
            key
          );


        group.periods.push(
          period
        );


        if (
          !group.itemMap.has(
            period.item_id
          )
        ) {

          group.itemMap.set(
            period.item_id,
            {
              item:
                period.item,

              periods:
                []
            }
          );
        }


        group.itemMap
          .get(
            period.item_id
          )
          .periods
          .push(
            period
          );
      }
    );


    return Array.from(
      groups.values()
    )
      .map(
        group => {

          const itemEntries =
            Array.from(
              group.itemMap.values()
            );


          const uniqueItems =
            itemEntries.map(
              entry =>
                entry.item
            );


          const totalAmount =
            round2(
              group.periods.reduce(
                (
                  sum,
                  period
                ) =>
                  sum +
                  period.amount_ex_vat,
                0
              )
            );


          /*
           * Voor het volume tonen we het unieke fysieke volume,
           * niet volume × aantal weken.
           */
          const totalVolume =
            round3(
              uniqueItems.reduce(
                (
                  sum,
                  item
                ) =>
                  sum +
                  item.volume_m3,
                0
              )
            );


          const maxWeeks =
            Math.max(
              0,
              ...itemEntries.map(
                entry =>
                  entry.periods.length
              )
            );


          const earliestPeriod =
            group.periods
              .map(
                period =>
                  toDate(
                    period.period_start
                  )
              )
              .filter(
                Boolean
              )
              .sort(
                (
                  a,
                  b
                ) =>
                  a -
                  b
              )[0] ||
            null;


          return {
            ...group,

            items:
              uniqueItems,

            itemEntries,

            packages:
              uniqueItems.length,

            volume_m3:
              totalVolume,

            weekly_charge:
              round2(
                totalVolume *
                STORAGE_RATE_PER_M3_WEEK
              ),

            full_weeks:
              maxWeeks,

            chargeable_since:
              dateKey(
                earliestPeriod ||
                group.grace_period_end
              ),

            amount:
              totalAmount
          };
        }
      )
      .sort(
        (
          a,
          b
        ) => {

          const dateCompare =
            String(
              a.inbound_date
            )
              .localeCompare(
                String(
                  b.inbound_date
                )
              );


          if (
            dateCompare !== 0
          ) {
            return dateCompare;
          }


          return String(
            a.sku_base
          )
            .localeCompare(
              String(
                b.sku_base
              )
            );
        }
      );
  }


  // ==========================================================
  // 8 WEEK FORECAST
  // ==========================================================

  function calculateForecast(
    filteredItems,
    asAtDate
  ) {

    /*
     * Alleen de voorraad die op de calculate-as-at datum
     * daadwerkelijk vrije voorraad is.
     */
    const snapshotItems =
      filteredItems.filter(
        item =>
          isCurrentlyFreeStock(
            item
          )
      );


    const result =
      [];


    let previousWeeklyCharge =
      0;


    for (
      let weekNo = 1;
      weekNo <=
        FORECAST_WEEKS;
      weekNo += 1
    ) {

      const forecastDate =
        addDays(
          asAtDate,
          weekNo * 7
        );


      /*
       * Een item telt in de wekelijkse forecast zodra er op
       * forecastDate minimaal één VOLLEDIGE week na graceEnd
       * verstreken is.
       */
      const includedItems =
        snapshotItems.filter(
          item => {

            if (
              !item.graceEnd
            ) {
              return false;
            }


            const firstChargeDate =
              addDays(
                item.graceEnd,
                7
              );


            return (
              firstChargeDate &&
              firstChargeDate <=
                forecastDate
            );
          }
        );


      const volume =
        round3(
          includedItems.reduce(
            (
              sum,
              item
            ) =>
              sum +
              item.volume_m3,
            0
          )
        );


      const weeklyCharge =
        round2(
          volume *
          STORAGE_RATE_PER_M3_WEEK
        );


      const change =
        round2(
          weekNo === 1
            ? weeklyCharge -
              currentCalculationWeeklyBase(
                snapshotItems,
                asAtDate
              )
            : weeklyCharge -
              previousWeeklyCharge
        );


      result.push({
        weekNo,
        forecastDate,
        includedItems,
        volume_m3:
          volume,
        weeklyCharge,
        change
      });


      previousWeeklyCharge =
        weeklyCharge;
    }


    return result;
  }


  function currentCalculationWeeklyBase(
    items,
    asAtDate
  ) {

    const volume =
      items
        .filter(
          item =>
            item.graceEnd &&
            addDays(
              item.graceEnd,
              7
            ) <=
              asAtDate
        )
        .reduce(
          (
            sum,
            item
          ) =>
            sum +
            item.volume_m3,
          0
        );


    return round2(
      volume *
      STORAGE_RATE_PER_M3_WEEK
    );
  }


  // ==========================================================
  // UPCOMING CHARGES
  // ==========================================================

  function calculateUpcoming(
    filteredItems,
    asAtDate
  ) {

    const freeItems =
      filteredItems.filter(
        item =>
          isCurrentlyFreeStock(
            item
          ) &&
          item.graceEnd
      );


    const map =
      new Map();


    freeItems.forEach(
      item => {

        const firstChargeDate =
          addDays(
            item.graceEnd,
            7
          );


        if (
          !firstChargeDate ||
          firstChargeDate <=
            asAtDate
        ) {
          return;
        }


        const key =
          dateKey(
            firstChargeDate
          );


        if (
          !map.has(
            key
          )
        ) {

          map.set(
            key,
            {
              firstChargeDate,
              items: []
            }
          );
        }


        map
          .get(
            key
          )
          .items
          .push(
            item
          );
      }
    );


    const rows =
      Array.from(
        map.values()
      )
        .map(
          group => {

            const volume =
              round3(
                group.items.reduce(
                  (
                    sum,
                    item
                  ) =>
                    sum +
                    item.volume_m3,
                  0
                )
              );


            const skuCount =
              new Set(
                group.items.map(
                  item =>
                    item.sku_base
                )
              )
                .size;


            return {
              ...group,

              skuCount,

              packages:
                group.items.length,

              volume_m3:
                volume,

              additionalWeeklyCharge:
                round2(
                  volume *
                  STORAGE_RATE_PER_M3_WEEK
                )
            };
          }
        )
        .sort(
          (
            a,
            b
          ) =>
            a.firstChargeDate -
            b.firstChargeDate
        );


    /*
     * Running weekly total.
     */
    let running =
      currentCalculationWeeklyBase(
        freeItems,
        asAtDate
      );


    rows.forEach(
      row => {

        running =
          round2(
            running +
            row.additionalWeeklyCharge
          );


        row.forecastWeeklyTotal =
          running;
      }
    );


    return rows;
  }


  // ==========================================================
  // RENDER EVERYTHING
  // ==========================================================

  function renderCalculation() {

    if (
      !currentCalculation
    ) {
      return;
    }


    renderKpis();

    renderSummary();

    renderInvoiceTable();

    renderForecast();

    renderUpcoming();

    updateGenerateButton();
  }


  // ==========================================================
  // KPI
  // ==========================================================

  function renderKpis() {

    const calc =
      currentCalculation;


    els.kpiChargeableVolume.textContent =
      formatVolume(
        calc.currentChargeableVolume
      );


    els.kpiChargeablePackages.textContent =
      String(
        calc.currentChargeableItems.length
      );


    els.kpiWeeklyCharge.textContent =
      formatMoney(
        calc.currentWeeklyCharge
      );


    els.kpiAmountDue.textContent =
      formatMoney(
        calc.amountDue
      );


    const next =
      calc.upcoming[0];


    if (next) {

      els.kpiNextIncrease.textContent =
        formatDate(
          next.firstChargeDate
        );


      els.kpiNextIncreaseNote.textContent =
        `+${formatMoney(
          next.additionalWeeklyCharge
        )} per week`;

    } else {

      els.kpiNextIncrease.textContent =
        "—";


      els.kpiNextIncreaseNote.textContent =
        "No upcoming increase";
    }
  }


  // ==========================================================
  // SUMMARY
  // ==========================================================

  function renderSummary() {

    const subtotal =
      currentCalculation.amountDue;


    const vat =
      round2(
        subtotal *
        DEFAULT_VAT_RATE
      );


    const total =
      round2(
        subtotal +
        vat
      );


    els.summarySubtotal.textContent =
      formatMoney(
        subtotal
      );


    els.summaryVat.textContent =
      formatMoney(
        vat
      );


    els.summaryVatLabel.textContent =
      `VAT ${Math.round(
        DEFAULT_VAT_RATE *
        100
      )}%`;


    els.summaryTotal.textContent =
      formatMoney(
        total
      );


    if (
      subtotal > 0
    ) {

      els.invoiceStatusBadge.textContent =
        "Ready to invoice";


      els.invoiceStatusBadge.className =
        "soft-pill green";

    } else {

      els.invoiceStatusBadge.textContent =
        "Nothing to invoice";


      els.invoiceStatusBadge.className =
        "soft-pill gray";
    }
  }


  // ==========================================================
  // TO INVOICE TABLE
  // ==========================================================

  function renderInvoiceTable() {

    const rows =
      currentCalculation
        .groupedInvoiceLines;


    if (
      !rows.length
    ) {

      els.invoiceTableBody.innerHTML =
        `
          <tr>
            <td
              colspan="11"
              class="storage-empty"
            >
              No completed, uninvoiced storage weeks found.
            </td>
          </tr>
        `;

      return;
    }


    els.invoiceTableBody.innerHTML =
      rows.map(
        (
          row,
          index
        ) => `
          <tr
            data-storage-line-index="${index}"
            style="cursor:pointer;"
          >

            <td>
              <span class="storage-sku">
                ${escapeHtml(
                  row.sku_base
                )}
              </span>
            </td>

            <td>
              ${escapeHtml(
                row.product_name ||
                "—"
              )}
            </td>

            <td>
              ${formatDate(
                row.inbound_date
              )}
            </td>

            <td>
              ${formatDate(
                row.grace_period_end
              )}
            </td>

            <td>
              ${formatDate(
                row.chargeable_since
              )}
            </td>

            <td class="storage-number">
              ${row.full_weeks}
            </td>

            <td class="storage-number">
              ${row.packages}
            </td>

            <td class="storage-number">
              ${row.volume_m3.toFixed(
                3
              )}
            </td>

            <td class="storage-money">
              ${formatMoney(
                row.weekly_charge
              )}
            </td>

            <td class="storage-money">
              <strong>
                ${formatMoney(
                  row.amount
                )}
              </strong>
            </td>

            <td>
              <span class="soft-pill green">
                To invoice
              </span>
            </td>

          </tr>
        `
      )
        .join(
          ""
        );


    els.invoiceTableBody
      .querySelectorAll(
        "[data-storage-line-index]"
      )
      .forEach(
        row => {

          row.addEventListener(
            "click",
            () => {

              const index =
                Number(
                  row.dataset
                    .storageLineIndex
                );


              showInvoiceLineDetail(
                rows[index]
              );
            }
          );
        }
      );
  }


  function showInvoiceLineDetail(
    line
  ) {

    if (!line) {
      return;
    }


    els.invoiceDetailTitle.textContent =
      `${line.sku_base} · Storage Charge Detail`;


    const rows =
      [];


    line.itemEntries.forEach(
      entry => {

        const item =
          entry.item;


        entry.periods.forEach(
          period => {

            rows.push(`
              <tr>

                <td>
                  <strong>
                    ${escapeHtml(
                      item.sku_base
                    )}
                  </strong>

                  <span class="subline">
                    Package
                    ${item.package_no}/${item.package_total}
                  </span>
                </td>

                <td>
                  <span
                    title="${escapeHtml(
                      item.id
                    )}"
                  >
                    ${escapeHtml(
                      String(
                        item.id
                      ).slice(
                        0,
                        8
                      )
                    )}…
                  </span>
                </td>

                <td>
                  ${escapeHtml(
                    item.warehouse_name ||
                    "—"
                  )}
                </td>

                <td>
                  ${escapeHtml(
                    item.location_code ||
                    "—"
                  )}
                </td>

                <td>
                  ${formatDate(
                    item.inboundDate
                  )}
                </td>

                <td>
                  ${formatDate(
                    period.period_start
                  )}
                  –
                  ${formatDate(
                    period.period_end
                  )}
                </td>

                <td class="storage-number">
                  ${item.volume_m3.toFixed(
                    3
                  )}
                </td>

                <td class="storage-money">
                  ${formatMoney(
                    period.amount_ex_vat
                  )}
                </td>

              </tr>
            `);
          }
        );
      }
    );


    els.invoiceDetailBody.innerHTML =
      rows.join(
        ""
      );


    els.invoiceDetailPanel.classList.add(
      "visible"
    );
  }


  // ==========================================================
  // FORECAST RENDER
  // ==========================================================

  function renderForecast() {

    const forecast =
      currentCalculation.forecast;


    els.forecastWeeks.innerHTML =
      forecast.map(
        row => {

          const positiveChange =
            row.change > 0;


          return `
            <div
              class="forecast-week ${
                selectedForecastWeek ===
                row.weekNo
                  ? "active"
                  : ""
              }"
              data-forecast-week="${row.weekNo}"
            >

              <div class="forecast-week-label">
                Week ${row.weekNo}
              </div>

              <div class="forecast-week-date">
                ${formatDate(
                  row.forecastDate
                )}
              </div>

              <div class="forecast-week-total">
                ${formatMoney(
                  row.weeklyCharge
                )}
              </div>

              <div class="forecast-week-change">
                ${
                  positiveChange
                    ? `+${formatMoney(
                        row.change
                      )} / week`
                    : "No increase"
                }
              </div>

            </div>
          `;
        }
      )
        .join(
          ""
        );


    els.forecastWeeks
      .querySelectorAll(
        "[data-forecast-week]"
      )
      .forEach(
        card => {

          card.addEventListener(
            "click",
            () => {

              const weekNo =
                Number(
                  card.dataset
                    .forecastWeek
                );


              selectedForecastWeek =
                weekNo;


              renderForecast();

              showForecastDetail(
                weekNo
              );
            }
          );
        }
      );
  }


  function showForecastDetail(
    weekNo
  ) {

    const row =
      currentCalculation
        .forecast
        .find(
          forecast =>
            forecast.weekNo ===
            weekNo
        );


    if (!row) {
      return;
    }


    els.forecastDetailTitle.textContent =
      `Week ${weekNo} · ${formatDate(
        row.forecastDate
      )} · ${formatMoney(
        row.weeklyCharge
      )} per week`;


    const groups =
      groupForecastItems(
        row.includedItems
      );


    if (
      !groups.length
    ) {

      els.forecastDetailBody.innerHTML =
        `
          <tr>
            <td
              colspan="8"
              class="storage-empty"
            >
              No chargeable stock forecast for this week.
            </td>
          </tr>
        `;

    } else {

      els.forecastDetailBody.innerHTML =
        groups.map(
          group => `
            <tr>

              <td>
                <span class="storage-sku">
                  ${escapeHtml(
                    group.sku_base
                  )}
                </span>
              </td>

              <td>
                ${escapeHtml(
                  group.product_name ||
                  "—"
                )}
              </td>

              <td>
                ${formatDate(
                  group.inbound_date
                )}
              </td>

              <td>
                ${formatDate(
                  group.grace_end
                )}
              </td>

              <td>
                ${formatDate(
                  group.first_charge_date
                )}
              </td>

              <td class="storage-number">
                ${group.packages}
              </td>

              <td class="storage-number">
                ${group.volume_m3.toFixed(
                  3
                )}
              </td>

              <td class="storage-money">
                ${formatMoney(
                  group.weekly_charge
                )}
              </td>

            </tr>
          `
        )
          .join(
            ""
          );
    }


    els.forecastDetailPanel.classList.add(
      "visible"
    );
  }


  function groupForecastItems(
    items
  ) {

    const map =
      new Map();


    items.forEach(
      item => {

        const key =
          [
            item.sku_base,
            dateKey(
              item.inboundDate
            ),
            dateKey(
              item.graceEnd
            )
          ].join(
            "|"
          );


        if (
          !map.has(
            key
          )
        ) {

          map.set(
            key,
            {
              sku_base:
                item.sku_base,

              product_name:
                item.product_name,

              inbound_date:
                dateKey(
                  item.inboundDate
                ),

              grace_end:
                dateKey(
                  item.graceEnd
                ),

              first_charge_date:
                dateKey(
                  addDays(
                    item.graceEnd,
                    7
                  )
                ),

              items: []
            }
          );
        }


        map
          .get(
            key
          )
          .items
          .push(
            item
          );
      }
    );


    return Array.from(
      map.values()
    )
      .map(
        group => {

          const volume =
            round3(
              group.items.reduce(
                (
                  sum,
                  item
                ) =>
                  sum +
                  item.volume_m3,
                0
              )
            );


          return {
            ...group,

            packages:
              group.items.length,

            volume_m3:
              volume,

            weekly_charge:
              round2(
                volume *
                STORAGE_RATE_PER_M3_WEEK
              )
          };
        }
      )
      .sort(
        (
          a,
          b
        ) =>
          String(
            a.sku_base
          )
            .localeCompare(
              String(
                b.sku_base
              )
            )
      );
  }


  // ==========================================================
  // UPCOMING TABLE
  // ==========================================================

  function renderUpcoming() {

    const rows =
      currentCalculation
        .upcoming;


    if (
      !rows.length
    ) {

      els.upcomingTableBody.innerHTML =
        `
          <tr>
            <td
              colspan="6"
              class="storage-empty"
            >
              No upcoming storage charges found.
            </td>
          </tr>
        `;

      return;
    }


    els.upcomingTableBody.innerHTML =
      rows.map(
        row => `
          <tr>

            <td>
              ${formatDate(
                row.firstChargeDate
              )}
            </td>

            <td class="storage-number">
              ${row.skuCount}
            </td>

            <td class="storage-number">
              ${row.packages}
            </td>

            <td class="storage-number">
              ${row.volume_m3.toFixed(
                3
              )}
            </td>

            <td class="storage-money">
              +${formatMoney(
                row.additionalWeeklyCharge
              )}
            </td>

            <td class="storage-money">
              <strong>
                ${formatMoney(
                  row.forecastWeeklyTotal
                )}
              </strong>
            </td>

          </tr>
        `
      )
        .join(
          ""
        );
  }


  // ==========================================================
  // STORAGE INVOICE HISTORY
  // ==========================================================

  async function loadStorageInvoiceHistory() {

    const {
      data: invoices,
      error
    } =
      await db
        .from(
          "invoices"
        )
        .select(`
          id,
          customer_id,
          invoice_number,
          invoice_date,
          subtotal,
          vat_amount,
          total_amount,
          status,
          file_url,
          pdf_url,
          customers (
            id,
            name,
            customer_code
          )
        `)
        .eq(
          "company_id",
          companyId
        )
        .eq(
          "invoice_type",
          "storage"
        )
        .order(
          "invoice_date",
          {
            ascending: false
          }
        );


    if (error) {
      throw error;
    }


    const invoiceRows =
      invoices || [];


    if (
      !invoiceRows.length
    ) {

      els.historyTableBody.innerHTML =
        `
          <tr>
            <td
              colspan="9"
              class="storage-empty"
            >
              No storage invoices found.
            </td>
          </tr>
        `;

      return;
    }


    const invoiceIds =
      invoiceRows.map(
        invoice =>
          invoice.id
      );


    const {
      data: periods,
      error: periodError
    } =
      await db
        .from(
          "storage_charge_periods"
        )
        .select(`
          invoice_id,
          item_id,
          volume_m3
        `)
        .in(
          "invoice_id",
          invoiceIds
        )
        .eq(
          "status",
          "invoiced"
        );


    if (periodError) {
      throw periodError;
    }


    const periodMap =
      new Map();


    (
      periods ||
      []
    ).forEach(
      period => {

        if (
          !periodMap.has(
            period.invoice_id
          )
        ) {

          periodMap.set(
            period.invoice_id,
            {
              items:
                new Map()
            }
          );
        }


        const group =
          periodMap.get(
            period.invoice_id
          );


        if (
          !group.items.has(
            period.item_id
          )
        ) {

          group.items.set(
            period.item_id,
            toNumber(
              period.volume_m3,
              0
            )
          );
        }
      }
    );


    els.historyTableBody.innerHTML =
      invoiceRows.map(
        invoice => {

          const group =
            periodMap.get(
              invoice.id
            );


          const uniqueItems =
            group
              ? Array.from(
                  group.items
                    .entries()
                )
              : [];


          const packages =
            uniqueItems.length;


          const volume =
            round3(
              uniqueItems.reduce(
                (
                  sum,
                  [
                    ,
                    itemVolume
                  ]
                ) =>
                  sum +
                  itemVolume,
                0
              )
            );


          const url =
            invoice.file_url ||
            invoice.pdf_url ||
            "";


          return `
            <tr>

              <td>
                ${
                  url
                    ? `
                      <a
                        href="${escapeHtml(
                          url
                        )}"
                        target="_blank"
                        rel="noopener"
                        class="storage-sku"
                      >
                        ${escapeHtml(
                          invoice.invoice_number
                        )}
                      </a>
                    `
                    : escapeHtml(
                        invoice.invoice_number
                      )
                }
              </td>

              <td>
                ${formatDate(
                  invoice.invoice_date
                )}
              </td>

              <td>
                ${escapeHtml(
                  invoice.customers
                    ?.name ||
                  "—"
                )}
              </td>

              <td class="storage-number">
                ${packages}
              </td>

              <td class="storage-number">
                ${volume.toFixed(
                  3
                )}
              </td>

              <td class="storage-money">
                ${formatMoney(
                  invoice.subtotal
                )}
              </td>

              <td class="storage-money">
                ${formatMoney(
                  invoice.vat_amount
                )}
              </td>

              <td class="storage-money">
                <strong>
                  ${formatMoney(
                    invoice.total_amount
                  )}
                </strong>
              </td>

              <td>
                <span class="status-pill status-${escapeHtml(
                  normalize(
                    invoice.status
                  )
                )}">
                  ${escapeHtml(
                    invoice.status
                  )}
                </span>
              </td>

            </tr>
          `;
        }
      )
        .join(
          ""
        );
  }


  // ==========================================================
  // FILTER OPTIONS
  // ==========================================================

  function renderFilterOptions() {

    if (
      els.customerFilter
    ) {

      els.customerFilter.innerHTML =
        `
          <option value="">
            All Product Owners
          </option>
        ` +
        allCustomers.map(
          customer => `
            <option
              value="${escapeHtml(
                customer.id
              )}"
            >
              ${escapeHtml(
                customer.name
              )}
            </option>
          `
        )
          .join(
            ""
          );


      /*
       * Bellstone standaard selecteren wanneer aanwezig.
       */
      const bellstone =
        allCustomers.find(
          customer =>
            normalize(
              customer.customer_code
            ) ===
              "bellstone" ||
            normalize(
              customer.name
            ).includes(
              "bellstone"
            )
        );


      if (bellstone) {
        els.customerFilter.value =
          bellstone.id;
      }
    }


    if (
      els.barnFilter
    ) {

      els.barnFilter.innerHTML =
        `
          <option value="">
            All Barns
          </option>
        ` +
        allWarehouses.map(
          warehouse => `
            <option
              value="${escapeHtml(
                warehouse.id
              )}"
            >
              ${escapeHtml(
                warehouse.name
              )}
            </option>
          `
        )
          .join(
            ""
          );
    }
  }


  function setDefaultViewDate() {

    if (
      !els.viewDate
    ) {
      return;
    }


    if (
      !els.viewDate.value
    ) {
      els.viewDate.value =
        dateKey(
          new Date()
        );
    }
  }


  // ==========================================================
  // GENERATE INVOICE BUTTON
  // ==========================================================

  function getInvoiceCustomerIds() {

    if (
      !currentCalculation
    ) {
      return [];
    }


    return [
      ...new Set(
        currentCalculation
          .uninvoicedPeriods
          .map(
            period =>
              period.customer_id
          )
          .filter(
            Boolean
          )
      )
    ];
  }


  function updateGenerateButton() {

    const customerIds =
      getInvoiceCustomerIds();


    const canGenerate =
      currentCalculation &&
      currentCalculation.amountDue >
        0 &&
      customerIds.length ===
        1;


    els.generateInvoiceBtn.disabled =
      !canGenerate;


    if (
      currentCalculation &&
      currentCalculation.amountDue >
        0 &&
      customerIds.length >
        1
    ) {

      els.invoiceStatusBadge.textContent =
        "Select one Product Owner";


      els.invoiceStatusBadge.className =
        "soft-pill orange";
    }
  }


  async function generateStorageInvoice() {

    if (
      !currentCalculation
    ) {
      return;
    }


    const customerIds =
      getInvoiceCustomerIds();


    if (
      customerIds.length !==
      1
    ) {

      showNotice(
        "Select one Product Owner before generating a storage invoice.",
        "err"
      );

      return;
    }


    if (
      !currentCalculation
        .uninvoicedPeriods
        .length
    ) {

      showNotice(
        "There are no storage periods to invoice.",
        "err"
      );

      return;
    }


    /*
     * De daadwerkelijke generator schrijven we als volgende bestand.
     */
    if (
      !window.StorageInvoiceGenerator
        ?.generate
    ) {

      showNotice(
        "The storage invoice calculation is ready. storage-invoice-generator.js still needs to be added before the PDF can be generated.",
        "err"
      );

      return;
    }


    const customerId =
      customerIds[0];


    const customer =
      allCustomers.find(
        row =>
          String(
            row.id
          ) ===
          String(
            customerId
          )
      );


    const confirmed =
      window.confirm(
        [
          "Generate Storage Invoice?",
          "",
          `Product Owner: ${customer?.name || "—"}`,
          `Storage charge excl. VAT: ${formatMoney(
            currentCalculation.amountDue
          )}`,
          `Periods: ${currentCalculation.uninvoicedPeriods.length}`,
          "",
          "All included storage weeks will be marked as invoiced."
        ].join(
          "\n"
        )
      );


    if (!confirmed) {
      return;
    }


    try {

      setBusy(
        true
      );

      clearNotice();


      const result =
        await window
          .StorageInvoiceGenerator
          .generate({
            client:
              db,

            companyId,

            customerId,

            asAtDate:
              dateKey(
                currentCalculation
                  .asAtDate
              ),

            ratePerM3Week:
              STORAGE_RATE_PER_M3_WEEK,

            vatRate:
              DEFAULT_VAT_RATE,

            periods:
              currentCalculation
                .uninvoicedPeriods
                .map(
                  period => ({
                    item_id:
                      period.item_id,

                    product_id:
                      period.product_id,

                    customer_id:
                      period.customer_id,

                    sku_base:
                      period.sku_base,

                    package_no:
                      period.package_no,

                    package_total:
                      period.package_total,

                    inbound_date:
                      period.inbound_date,

                    grace_period_end:
                      period.grace_period_end,

                    period_start:
                      period.period_start,

                    period_end:
                      period.period_end,

                    volume_m3:
                      period.volume_m3,

                    rate_per_m3_week:
                      period.rate_per_m3_week,

                    amount_ex_vat:
                      period.amount_ex_vat
                  })
                ),

            lines:
              currentCalculation
                .groupedInvoiceLines
                .map(
                  line => ({
                    sku_base:
                      line.sku_base,

                    product_name:
                      line.product_name,

                    inbound_date:
                      line.inbound_date,

                    grace_period_end:
                      line.grace_period_end,

                    full_weeks:
                      line.full_weeks,

                    packages:
                      line.packages,

                    volume_m3:
                      line.volume_m3,

                    weekly_charge:
                      line.weekly_charge,

                    amount:
                      line.amount
                  })
                )
          });


      showNotice(
        `Storage invoice ${result?.invoiceNumber || ""} generated successfully.`,
        "ok"
      );


      await refreshAll();

    } catch (error) {

      console.error(
        "Storage invoice generation failed:",
        error
      );


      showNotice(
        error.message ||
        "Storage invoice could not be generated.",
        "err"
      );

    } finally {

      setBusy(
        false
      );
    }
  }


  // ==========================================================
  // EXPORT
  // ==========================================================

  function exportCurrentCalculation() {

    if (
      !currentCalculation
        ?.groupedInvoiceLines
        ?.length
    ) {

      showNotice(
        "There is no current storage calculation to export.",
        "err"
      );

      return;
    }


    const header =
      [
        "SKU",
        "Product",
        "Inbound Date",
        "Grace Period End",
        "Full Weeks",
        "Packages",
        "Volume m3",
        "Rate per m3/week",
        "Weekly Charge",
        "Amount To Invoice"
      ];


    const rows =
      currentCalculation
        .groupedInvoiceLines
        .map(
          line => [
            line.sku_base,
            line.product_name,
            line.inbound_date,
            line.grace_period_end,
            line.full_weeks,
            line.packages,
            line.volume_m3.toFixed(
              3
            ),
            STORAGE_RATE_PER_M3_WEEK.toFixed(
              2
            ),
            line.weekly_charge.toFixed(
              2
            ),
            line.amount.toFixed(
              2
            )
          ]
        );


    const csv =
      [
        header,
        ...rows
      ]
        .map(
          row =>
            row.map(
              value =>
                `"${String(
                  value ?? ""
                )
                  .replace(
                    /"/g,
                    '""'
                  )}"`
            )
              .join(
                ","
              )
        )
        .join(
          "\n"
        );


    const blob =
      new Blob(
        [
          csv
        ],
        {
          type:
            "text/csv;charset=utf-8"
        }
      );


    const url =
      URL.createObjectURL(
        blob
      );


    const anchor =
      document.createElement(
        "a"
      );


    anchor.href =
      url;


    anchor.download =
      `storage-invoicing-${dateKey(
        currentCalculation
          .asAtDate
      )}.csv`;


    document.body.appendChild(
      anchor
    );


    anchor.click();

    anchor.remove();


    URL.revokeObjectURL(
      url
    );
  }


  // ==========================================================
  // TABS
  // ==========================================================

  function bindTabs() {

    document
      .querySelectorAll(
        "[data-storage-tab]"
      )
      .forEach(
        button => {

          button.addEventListener(
            "click",
            () => {

              const tab =
                button.dataset
                  .storageTab;


              activeTab =
                tab;


              document
                .querySelectorAll(
                  "[data-storage-tab]"
                )
                .forEach(
                  btn => {

                    btn.classList.toggle(
                      "active",
                      btn.dataset
                        .storageTab ===
                        tab
                    );
                  }
                );


              document
                .querySelectorAll(
                  ".storage-tab-panel"
                )
                .forEach(
                  panel => {

                    panel.classList.remove(
                      "active"
                    );
                  }
                );


              const target =
                {
                  toInvoice:
                    "storageTabToInvoice",

                  upcoming:
                    "storageTabUpcoming",

                  history:
                    "storageTabHistory"
                }[
                  tab
                ];


              if (
                target
              ) {

                document
                  .getElementById(
                    target
                  )
                  ?.classList
                  .add(
                    "active"
                  );
              }
            }
          );
        }
      );
  }


  // ==========================================================
  // EVENTS
  // ==========================================================

  function bindEvents() {

    els.refreshBtn
      ?.addEventListener(
        "click",
        refreshAll
      );


    els.exportBtn
      ?.addEventListener(
        "click",
        exportCurrentCalculation
      );


    els.generateInvoiceBtn
      ?.addEventListener(
        "click",
        generateStorageInvoice
      );


    els.customerFilter
      ?.addEventListener(
        "change",
        calculateStorage
      );


    els.barnFilter
      ?.addEventListener(
        "change",
        calculateStorage
      );


    els.viewDate
      ?.addEventListener(
        "change",
        calculateStorage
      );


    let searchTimer =
      null;


    els.skuFilter
      ?.addEventListener(
        "input",
        () => {

          clearTimeout(
            searchTimer
          );


          searchTimer =
            setTimeout(
              calculateStorage,
              250
            );
        }
      );


    els.forecastDetailCloseBtn
      ?.addEventListener(
        "click",
        () => {

          selectedForecastWeek =
            null;


          els.forecastDetailPanel
            ?.classList
            .remove(
              "visible"
            );


          renderForecast();
        }
      );


    els.invoiceDetailCloseBtn
      ?.addEventListener(
        "click",
        () => {

          els.invoiceDetailPanel
            ?.classList
            .remove(
              "visible"
            );
        }
      );
  }


  // ==========================================================
  // REFRESH
  // ==========================================================

  async function refreshAll() {

    try {

      setBusy(
        true
      );

      clearNotice();


      await Promise.all([
        loadAllItems(),
        loadExistingChargePeriods()
      ]);


      calculateStorage();


      await loadStorageInvoiceHistory();


      showNotice(
        "Storage calculation refreshed.",
        "ok"
      );

    } catch (error) {

      console.error(
        "Storage invoicing refresh failed:",
        error
      );


      showNotice(
        error.message ||
        "Storage calculation could not be loaded.",
        "err"
      );

    } finally {

      setBusy(
        false
      );
    }
  }


  // ==========================================================
  // INITIALISE
  // ==========================================================

  async function initialise() {

    try {

      cacheElements();

      db =
        getClient();


      await loadCurrentProfile();


      await Promise.all([
        loadCustomers(),
        loadWarehouses(),
        loadLocations()
      ]);


      renderFilterOptions();

      setDefaultViewDate();

      bindTabs();

      bindEvents();


      await refreshAll();


      document.body.classList.remove(
        "auth-loading"
      );

    } catch (error) {

      console.error(
        "Storage Invoicing initialisation failed:",
        error
      );


      document.body.classList.remove(
        "auth-loading"
      );


      showNotice(
        error.message ||
        "Storage Invoicing could not be initialised.",
        "err"
      );
    }
  }


  // ==========================================================
  // START
  // ==========================================================

  document.addEventListener(
    "DOMContentLoaded",
    initialise
  );


  // ==========================================================
  // OPTIONAL DEBUG API
  // ==========================================================

  window.StorageInvoicing = {

    refresh:
      refreshAll,

    recalculate:
      calculateStorage,

    getCalculation() {
      return currentCalculation;
    },

    getItems() {
      return allItems;
    },

    getExistingPeriods() {
      return existingChargePeriods;
    }
  };

})();