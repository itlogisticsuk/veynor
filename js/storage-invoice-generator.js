(function () {
  "use strict";


  // ==========================================================
  // CONFIGURATION
  // ==========================================================

  const DOCUMENT_BUCKET =
    "order-documents";

  const DEFAULT_VAT_RATE =
    0.20;

  const DEFAULT_PAYMENT_TERM_DAYS =
    14;

  const DEFAULT_STORAGE_RATE =
    1.20;


  const FALLBACK_COMPANY = {
    name:
      "Sofa2U Ltd",

    displayName:
      "Sofa2U",

    address:
      "860-862 Garratt Lane, London, SW17 0NB",

    phone:
      "+44 (0) 7894 469947",

    email:
      "sales@sofa2u.co.uk",

    vat:
      "GB 368 665 249",

    logoUrl:
      "",

    bankName:
      "NatWest",

    sortCode:
      "51-61-11",

    accountNo:
      "7797 5170",

    iban:
      "",

    bic:
      "",

    paymentNote:
      "Please make payments via bank transfer using the details shown on this invoice.",

    footerText:
      ""
  };


  // ==========================================================
  // BASIC HELPERS
  // ==========================================================

  function toNumber(
    value,
    fallback = 0
  ) {
    const num =
      Number(
        String(
          value ?? ""
        ).replace(
          ",",
          "."
        )
      );

    return Number.isFinite(
      num
    )
      ? num
      : fallback;
  }


  function round2(value) {
    return Number(
      toNumber(
        value,
        0
      ).toFixed(
        2
      )
    );
  }


  function round3(value) {
    return Number(
      toNumber(
        value,
        0
      ).toFixed(
        3
      )
    );
  }


  function cleanText(value) {
    return String(
      value ?? ""
    )
      .replace(
        /\s+/g,
        " "
      )
      .trim();
  }


  function normalize(value) {
    return cleanText(
      value
    ).toLowerCase();
  }


  function formatMoney(value) {
    const num =
      toNumber(
        value,
        0
      );

    return `£ ${num.toLocaleString(
      "en-GB",
      {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }
    )}`;
  }


  function formatVolume(value) {
    return toNumber(
      value,
      0
    ).toLocaleString(
      "en-GB",
      {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3
      }
    );
  }


  function formatRate(value) {
    return `£${toNumber(
      value,
      DEFAULT_STORAGE_RATE
    ).toFixed(
      2
    )}`;
  }


  function parseDate(value) {
    if (!value) {
      return null;
    }

    const raw =
      String(
        value
      );

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

    const date =
      new Date(
        value
      );

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return null;
    }

    return date;
  }


  function formatDate(value) {
    const date =
      parseDate(
        value
      );

    if (!date) {
      return "—";
    }

    return date.toLocaleDateString(
      "en-GB"
    );
  }


  function dateKey(value) {
    const date =
      parseDate(
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


  function addDays(
    value,
    days
  ) {
    const date =
      parseDate(
        value
      ) ||
      new Date();

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


  function safeFilePart(value) {
    return String(
      value || ""
    )
      .replace(
        /[^a-zA-Z0-9_-]/g,
        "_"
      )
      .replace(
        /_+/g,
        "_"
      )
      .replace(
        /^_+|_+$/g,
        ""
      );
  }


  function splitText(
    doc,
    text,
    width
  ) {
    return doc.splitTextToSize(
      String(
        text || ""
      ),
      width
    );
  }


  function setDark(doc) {
    doc.setTextColor(
      34,
      34,
      34
    );
  }


  function setMuted(doc) {
    doc.setTextColor(
      90,
      90,
      90
    );
  }


  // ==========================================================
  // INVOICE NUMBER
  // ==========================================================

  async function reserveNextInvoiceNumber(
    client,
    companyId,
    prefix = "INV"
  ) {
    const {
      data,
      error
    } =
      await client.rpc(
        "get_next_invoice_number",
        {
          p_company_id:
            companyId
        }
      );

    if (error) {
      throw new Error(
        `Could not reserve invoice number: ${error.message}`
      );
    }

    const number =
      Math.round(
        toNumber(
          data,
          0
        )
      );

    if (
      number <= 0
    ) {
      throw new Error(
        "Invalid invoice number returned."
      );
    }

    return `${prefix}-${String(
      number
    ).padStart(
      5,
      "0"
    )}`;
  }


  // ==========================================================
  // COMPANY SETTINGS
  // ==========================================================

  async function loadCompanySettings(
    client,
    companyId
  ) {
    const {
      data,
      error
    } =
      await client
        .from(
          "settings"
        )
        .select(
          "setting_key, setting_value"
        )
        .eq(
          "company_id",
          companyId
        );

    if (error) {
      console.warn(
        "Storage invoice settings fallback:",
        error.message
      );

      return {
        company:
          {
            ...FALLBACK_COMPANY
          },

        vatRate:
          DEFAULT_VAT_RATE,

        paymentTermDays:
          DEFAULT_PAYMENT_TERM_DAYS,

        invoicePrefix:
          "INV"
      };
    }

    const map =
      new Map(
        (
          data ||
          []
        ).map(
          row => [
            row.setting_key,
            row.setting_value ??
            ""
          ]
        )
      );

    const company = {
      name:
        map.get(
          "main_company_name"
        ) ||
        FALLBACK_COMPANY.name,

      displayName:
        map.get(
          "main_display_name"
        ) ||
        FALLBACK_COMPANY.displayName,

      registration:
        map.get(
          "main_company_registration"
        ) ||
        "",

      address:
        map.get(
          "main_address"
        ) ||
        FALLBACK_COMPANY.address,

      phone:
        map.get(
          "main_phone"
        ) ||
        FALLBACK_COMPANY.phone,

      email:
        map.get(
          "main_email"
        ) ||
        FALLBACK_COMPANY.email,

      vat:
        map.get(
          "main_vat"
        ) ||
        FALLBACK_COMPANY.vat,

      logoUrl:
        map.get(
          "main_logo_url"
        ) ||
        FALLBACK_COMPANY.logoUrl,

      bankCompanyName:
        map.get(
          "bank_company_name"
        ) ||
        map.get(
          "main_company_name"
        ) ||
        FALLBACK_COMPANY.name,

      bankName:
        map.get(
          "bank_name"
        ) ||
        FALLBACK_COMPANY.bankName,

      sortCode:
        map.get(
          "bank_sort_code"
        ) ||
        FALLBACK_COMPANY.sortCode,

      accountNo:
        map.get(
          "bank_account_no"
        ) ||
        FALLBACK_COMPANY.accountNo,

      iban:
        map.get(
          "bank_iban"
        ) ||
        "",

      bic:
        map.get(
          "bank_bic"
        ) ||
        "",

      paymentNote:
        map.get(
          "invoice_payment_note"
        ) ||
        FALLBACK_COMPANY.paymentNote,

      footerText:
        map.get(
          "document_footer_text"
        ) ||
        FALLBACK_COMPANY.footerText
    };

    return {
      company,

      vatRate:
        toNumber(
          map.get(
            "tax_default_vat_rate"
          ) ||
          map.get(
            "doc_vat_rate"
          ),
          DEFAULT_VAT_RATE
        ),

      paymentTermDays:
        Math.round(
          toNumber(
            map.get(
              "default_payment_terms_days"
            ) ||
            map.get(
              "doc_default_payment_terms"
            ),
            DEFAULT_PAYMENT_TERM_DAYS
          )
        ),

      invoicePrefix:
        map.get(
          "invoice_prefix"
        ) ||
        "INV"
    };
  }


  // ==========================================================
  // PRODUCT OWNER
  // ==========================================================

  async function loadProductOwnerProfile(
    client,
    customerId
  ) {
    if (!customerId) {
      throw new Error(
        "Product Owner/customer_id is missing."
      );
    }

    const {
      data: customer,
      error: customerError
    } =
      await client
        .from(
          "customers"
        )
        .select(
          "*"
        )
        .eq(
          "id",
          customerId
        )
        .maybeSingle();

    if (customerError) {
      throw customerError;
    }

    if (
      !customer?.id
    ) {
      throw new Error(
        "Product Owner/customer record not found."
      );
    }

    let address =
      null;

    const {
      data: addresses,
      error: addressError
    } =
      await client
        .from(
          "customer_addresses"
        )
        .select(
          "*"
        )
        .eq(
          "customer_id",
          customerId
        )
        .order(
          "is_default",
          {
            ascending:
              false
          }
        )
        .limit(
          1
        );

    if (
      !addressError &&
      addresses?.length
    ) {
      address =
        addresses[0];
    }

    return {
      id:
        customer.id,

      name:
        customer.name ||
        customer.trading_name ||
        "Product Owner",

      customerCode:
        customer.customer_code ||
        "",

      vat:
        customer.vat_number ||
        customer.vat ||
        "",

      email:
        customer.billing_email ||
        customer.email ||
        "",

      address1:
        address?.street ||
        customer.address1 ||
        customer.address_1 ||
        "",

      address2:
        address?.address2 ||
        customer.address2 ||
        customer.address_2 ||
        "",

      city:
        address?.city ||
        customer.city ||
        "",

      county:
        address?.county ||
        customer.county ||
        "",

      postcode:
        address?.postal_code ||
        address?.postcode ||
        customer.postcode ||
        "",

      country:
        address?.country ||
        customer.country ||
        "United Kingdom"
    };
  }


  // ==========================================================
  // IMAGE / LOGO HELPERS
  // ==========================================================

  function blobToDataUrl(blob) {
    return new Promise(
      (
        resolve,
        reject
      ) => {
        const reader =
          new FileReader();

        reader.onload =
          () =>
            resolve(
              String(
                reader.result ||
                ""
              )
            );

        reader.onerror =
          reject;

        reader.readAsDataURL(
          blob
        );
      }
    );
  }


  async function urlToDataUrl(url) {
    if (!url) {
      return "";
    }

    try {
      const response =
        await fetch(
          url,
          {
            mode:
              "cors"
          }
        );

      if (
        !response.ok
      ) {
        throw new Error(
          `Logo fetch failed: ${response.status}`
        );
      }

      const blob =
        await response.blob();

      return await blobToDataUrl(
        blob
      );

    } catch (error) {
      console.warn(
        "Storage invoice logo could not be loaded:",
        error.message
      );

      return "";
    }
  }


  function getImageFormat(
    dataUrl
  ) {
    const lower =
      String(
        dataUrl ||
        ""
      ).toLowerCase();

    if (
      lower.includes(
        "image/jpeg"
      ) ||
      lower.includes(
        "image/jpg"
      )
    ) {
      return "JPEG";
    }

    if (
      lower.includes(
        "image/webp"
      )
    ) {
      return "WEBP";
    }

    return "PNG";
  }


  function addLogo(
    doc,
    logoDataUrl,
    x,
    y,
    maxW,
    maxH
  ) {
    if (!logoDataUrl) {
      return false;
    }

    try {
      const props =
        doc.getImageProperties(
          logoDataUrl
        );

      const ratio =
        props.width /
        props.height;

      let width =
        maxW;

      let height =
        width /
        ratio;

      if (
        height >
        maxH
      ) {
        height =
          maxH;

        width =
          height *
          ratio;
      }

      doc.addImage(
        logoDataUrl,
        getImageFormat(
          logoDataUrl
        ),
        x,
        y,
        width,
        height
      );

      return true;

    } catch (error) {
      console.warn(
        "Storage invoice logo addImage failed:",
        error.message
      );

      return false;
    }
  }


  // ==========================================================
  // TOTALS
  // ==========================================================

function calculateTotals(
  periods,
  vatRate
) {

  /*
   * Eerst alle ongeronde storage-period bedragen optellen.
   * Pas daarna subtotal afronden op 2 decimalen.
   */
  const rawSubtotal =
    (
      periods ||
      []
    ).reduce(
      (
        sum,
        period
      ) =>
        sum +
        toNumber(
          period.amount_ex_vat,
          0
        ),
      0
    );


  const subtotal =
    round2(
      rawSubtotal
    );


  const vat =
    round2(
      subtotal *
      toNumber(
        vatRate,
        DEFAULT_VAT_RATE
      )
    );


  const total =
    round2(
      subtotal +
      vat
    );


  return {
    rawSubtotal,
    subtotal,
    vat,
    total
  };
}

  // ==========================================================
  // HISTORIC STORAGE PERIODS
  // ==========================================================

  async function loadPreviouslyInvoicedPeriods(
    client,
    companyId,
    customerId
  ) {
    const {
      data,
      error
    } =
      await client
        .from(
          "storage_charge_periods"
        )
        .select(`
          id,
          invoice_id,
          item_id,
          product_id,
          sku_base,
          inbound_date,
          grace_period_end,
          period_start,
          period_end,
          volume_m3,
          rate_per_m3_week,
          amount_ex_vat,
          status
        `)
        .eq(
          "company_id",
          companyId
        )
        .eq(
          "customer_id",
          customerId
        )
        .eq(
          "status",
          "invoiced"
        );

    if (error) {
      throw error;
    }

    return data || [];
  }


  function periodKey(period) {
    return [
      period.item_id,
      period.period_start,
      period.period_end
    ].join(
      "|"
    );
  }


  function validatePeriodsNotAlreadyInvoiced(
    periods,
    previousPeriods
  ) {
    const existing =
      new Set(
        (
          previousPeriods ||
          []
        ).map(
          period =>
            periodKey(
              period
            )
        )
      );

    const duplicates =
      (
        periods ||
        []
      ).filter(
        period =>
          existing.has(
            periodKey(
              period
            )
          )
      );

    if (
      duplicates.length
    ) {
      throw new Error(
        "One or more storage weeks have already been invoiced. Refresh Storage Invoicing before generating the invoice."
      );
    }
  }


  // ==========================================================
  // PRODUCT NAME LOOKUP
  // ==========================================================

  function createProductNameMap(lines) {
    const map =
      new Map();

    (
      lines ||
      []
    ).forEach(
      line => {
        const key =
          [
            normalize(
              line.sku_base
            ),
            String(
              line.inbound_date ||
              ""
            ),
            String(
              line.grace_period_end ||
              ""
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
            cleanText(
              line.product_name ||
              ""
            )
          );
        }
      }
    );

    return map;
  }


  // ==========================================================
  // BUILD SPECIFICATION
  //
  // Dit is bewust gebaseerd op individuele item-periods,
  // zodat Prev Weeks en This Invoice ook bij verschillen
  // tussen fysieke packages correct blijven.
  // ==========================================================

 function buildSpecificationLines(
  periods,
  previousPeriods,
  inputLines
) {

  const productNameMap =
    createProductNameMap(
      inputLines
    );


  // ========================================================
  // EERDER GEFACTUREERDE WEKEN PER FYSIEK ITEM
  // ========================================================

  const previousByItem =
    new Map();


  (
    previousPeriods ||
    []
  ).forEach(
    period => {

      const itemId =
        String(
          period.item_id ||
          ""
        );


      if (!itemId) {
        return;
      }


      if (
        !previousByItem.has(
          itemId
        )
      ) {

        previousByItem.set(
          itemId,
          new Set()
        );
      }


      previousByItem
        .get(
          itemId
        )
        .add(
          [
            period.period_start,
            period.period_end
          ].join(
            "|"
          )
        );
    }
  );


  // ========================================================
  // HUIDIGE FACTUUR PER FYSIEK ITEM
  // ========================================================

  const currentByItem =
    new Map();


  (
    periods ||
    []
  ).forEach(
    period => {

      const itemId =
        String(
          period.item_id ||
          ""
        );


      if (!itemId) {
        return;
      }


      if (
        !currentByItem.has(
          itemId
        )
      ) {

        currentByItem.set(
          itemId,
          {

            item_id:
              itemId,

            product_id:
              period.product_id,

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

            volume_m3:
              toNumber(
                period.volume_m3,
                0
              ),

            rate:
              toNumber(
                period.rate_per_m3_week,
                DEFAULT_STORAGE_RATE
              ),

            /*
             * Bewust ongerond bewaren.
             */
            rawAmount:
              0,

            currentWeeks:
              new Set()
          }
        );
      }


      const item =
        currentByItem.get(
          itemId
        );


      item.currentWeeks.add(
        [
          period.period_start,
          period.period_end
        ].join(
          "|"
        )
      );


      /*
       * BELANGRIJK:
       * Geen round2 per week.
       */
      item.rawAmount +=
        toNumber(
          period.amount_ex_vat,
          0
        );
    }
  );


  // ========================================================
  // ITEMS GROEPEREN VOOR PDF
  // ========================================================

  const groups =
    new Map();


  Array.from(
    currentByItem.values()
  ).forEach(
    item => {

      const previousWeeks =
        previousByItem.get(
          item.item_id
        )
          ?.size ||
        0;


      const thisInvoiceWeeks =
        item.currentWeeks.size;


      /*
       * Packages alleen samenvoegen wanneer deze kenmerken
       * werkelijk gelijk zijn.
       *
       * Daardoor blijft bijvoorbeeld:
       *
       * CRO802 | 18 packages | 3 weeks
       * CRO802 |  1 package  | 1 week
       *
       * correct gescheiden.
       */
      const key =
        [
          normalize(
            item.sku_base
          ),
          item.inbound_date,
          item.grace_period_end,
          previousWeeks,
          thisInvoiceWeeks,
          item.rate
        ].join(
          "|"
        );


      if (
        !groups.has(
          key
        )
      ) {

        const nameKey =
          [
            normalize(
              item.sku_base
            ),
            String(
              item.inbound_date ||
              ""
            ),
            String(
              item.grace_period_end ||
              ""
            )
          ].join(
            "|"
          );


        groups.set(
          key,
          {

            sku_base:
              item.sku_base,

            product_name:
              productNameMap.get(
                nameKey
              ) ||
              "",

            inbound_date:
              item.inbound_date,

            grace_period_end:
              item.grace_period_end,

            previous_weeks:
              previousWeeks,

            this_invoice_weeks:
              thisInvoiceWeeks,

            packages:
              0,

            volume_m3:
              0,

            rate:
              item.rate,

            /*
             * Eerst ongerond optellen.
             */
            rawAmount:
              0,

            amount:
              0,

            item_ids:
              []
          }
        );
      }


      const group =
        groups.get(
          key
        );


      group.packages +=
        1;


      group.volume_m3 +=
        toNumber(
          item.volume_m3,
          0
        );


      group.rawAmount +=
        item.rawAmount;


      group.item_ids.push(
        item.item_id
      );
    }
  );


  // ========================================================
  // PAS NU AFRONDEN
  // ========================================================

  return Array.from(
    groups.values()
  )
    .map(
      group => ({

        ...group,

        volume_m3:
          round3(
            group.volume_m3
          ),

        /*
         * Dit is de enige afronding voor de PDF-regel.
         */
        amount:
          round2(
            group.rawAmount
          )
      })
    )
    .sort(
      (
        a,
        b
      ) => {

        const inboundCompare =
          String(
            a.inbound_date
          )
            .localeCompare(
              String(
                b.inbound_date
              )
            );


        if (
          inboundCompare !== 0
        ) {
          return inboundCompare;
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
  // PDF HEADER
  // ==========================================================

  function drawHeader(
    doc,
    title,
    invoiceNumber,
    invoiceDate,
    dueDate,
    ctx,
    logoDataUrl
  ) {
    const pageWidth =
      doc.internal.pageSize.getWidth();

    const {
      company,
      paymentTermDays
    } =
      ctx;

    doc.setFillColor(
      17,
      24,
      39
    );

    doc.rect(
      0,
      0,
      pageWidth,
      17,
      "F"
    );

    doc.setFillColor(
      184,
      148,
      95
    );

    doc.rect(
      0,
      17,
      pageWidth,
      2.2,
      "F"
    );

    const logoAdded =
      addLogo(
        doc,
        logoDataUrl,
        14,
        25,
        48,
        22
      );

    setDark(
      doc
    );

    if (
      !logoAdded
    ) {
      doc.setFont(
        "helvetica",
        "bold"
      );

      doc.setFontSize(
        17
      );

      doc.text(
        ctx.company.displayName ||
        ctx.company.name,
        14,
        34
      );
    }

    doc.setFont(
      "helvetica",
      "bold"
    );

    doc.setFontSize(
      22
    );

    doc.text(
      title,
      pageWidth - 14,
      34,
      {
        align:
          "right"
      }
    );

    doc.setFont(
      "helvetica",
      "normal"
    );

    doc.setFontSize(
      9
    );

    doc.text(
      `Invoice No: ${invoiceNumber}`,
      pageWidth - 14,
      45,
      {
        align:
          "right"
      }
    );

    doc.text(
      `Invoice Date: ${formatDate(
        invoiceDate
      )}`,
      pageWidth - 14,
      52,
      {
        align:
          "right"
      }
    );

    doc.text(
      `Due Date: ${formatDate(
        dueDate
      )}`,
      pageWidth - 14,
      59,
      {
        align:
          "right"
      }
    );

    doc.text(
      `Payment Terms: ${paymentTermDays} days`,
      pageWidth - 14,
      66,
      {
        align:
          "right"
      }
    );

    const infoY =
      logoAdded
        ? 53
        : 43;

    doc.setFont(
      "helvetica",
      "bold"
    );

    doc.setFontSize(
      10
    );

    doc.text(
      company.name,
      14,
      infoY
    );

    doc.setFont(
      "helvetica",
      "normal"
    );

    doc.setFontSize(
      8.5
    );

    doc.text(
      cleanText(
        company.address
      ),
      14,
      infoY + 6
    );

    doc.setFont(
      "helvetica",
      "bold"
    );

    doc.text(
      "Phone",
      14,
      infoY + 15
    );

    doc.setFont(
      "helvetica",
      "normal"
    );

    doc.text(
      company.phone,
      28,
      infoY + 15
    );

    doc.setFont(
      "helvetica",
      "bold"
    );

    doc.text(
      "Email",
      78,
      infoY + 15
    );

    doc.setFont(
      "helvetica",
      "normal"
    );

    doc.text(
      company.email,
      92,
      infoY + 15
    );

    doc.setFont(
      "helvetica",
      "bold"
    );

    doc.text(
      `VAT No ${company.vat}`,
      14,
      infoY + 23
    );

    if (
      company.registration
    ) {
      doc.text(
        `Company No ${company.registration}`,
        78,
        infoY + 23
      );
    }
  }


  // ==========================================================
  // FOOTER - WERKT ZOWEL PORTRAIT ALS LANDSCAPE
  // ==========================================================

  function drawFooter(
    doc,
    company
  ) {
    const pageCount =
      doc.getNumberOfPages();

    for (
      let pageNo = 1;
      pageNo <=
        pageCount;
      pageNo += 1
    ) {
      doc.setPage(
        pageNo
      );

      const pageWidth =
        doc.internal.pageSize.getWidth();

      const pageHeight =
        doc.internal.pageSize.getHeight();

      const lineY =
        pageHeight - 20;

      doc.setDrawColor(
        215,
        215,
        215
      );

      doc.line(
        14,
        lineY,
        pageWidth - 14,
        lineY
      );

      setMuted(
        doc
      );

      doc.setFont(
        "helvetica",
        "normal"
      );

      doc.setFontSize(
        8
      );

      const footerLine1 =
        company.footerText ||
        `${company.name}  ${company.address}`;

      const footerLine2 =
        `Phone ${company.phone}   Email ${company.email}   VAT No ${company.vat}`;

      doc.text(
        footerLine1,
        pageWidth / 2,
        lineY + 6,
        {
          align:
            "center"
        }
      );

      doc.text(
        footerLine2,
        pageWidth / 2,
        lineY + 11,
        {
          align:
            "center"
        }
      );

      doc.text(
        `Page ${pageNo} of ${pageCount}`,
        pageWidth - 14,
        lineY + 11,
        {
          align:
            "right"
        }
      );

      setDark(
        doc
      );
    }
  }


  // ==========================================================
  // BILL TO
  // ==========================================================

  function drawBillTo(
    doc,
    y,
    productOwner
  ) {
    doc.setFillColor(
      248,
      249,
      251
    );

    doc.roundedRect(
      14,
      y - 6,
      86,
      56,
      2,
      2,
      "F"
    );

    doc.setDrawColor(
      220,
      224,
      231
    );

    doc.roundedRect(
      14,
      y - 6,
      86,
      56,
      2,
      2
    );

    setDark(
      doc
    );

    doc.setFont(
      "helvetica",
      "bold"
    );

    doc.setFontSize(
      10
    );

    doc.text(
      "Bill To",
      19,
      y
    );

    doc.setFont(
      "helvetica",
      "normal"
    );

    doc.setFontSize(
      8.8
    );

    const addressLines =
      [
        productOwner.name,
        productOwner.address1,
        productOwner.address2,
        productOwner.city,
        productOwner.county,
        productOwner.postcode,
        productOwner.country,
        productOwner.vat
          ? `VAT No: ${productOwner.vat}`
          : ""
      ].filter(
        Boolean
      );

    let lineY =
      y + 8;

    addressLines.forEach(
      line => {
        if (
          lineY <=
          y + 42
        ) {
          doc.text(
            cleanText(
              line
            ),
            19,
            lineY
          );

          lineY +=
            5;
        }
      }
    );
  }


  // ==========================================================
  // PAGE 1 OVERVIEW
  // ==========================================================

  function getUniqueInvoiceStats(
    periods
  ) {
    const items =
      new Map();

    (
      periods ||
      []
    ).forEach(
      period => {
        if (
          !items.has(
            period.item_id
          )
        ) {
          items.set(
            period.item_id,
            toNumber(
              period.volume_m3,
              0
            )
          );
        }
      }
    );

    const volume =
      round3(
        Array.from(
          items.values()
        ).reduce(
          (
            sum,
            value
          ) =>
            sum +
            value,
          0
        )
      );

    return {
      packages:
        items.size,

      volume
    };
  }


  function drawStorageOverview(
    doc,
    x,
    y,
    w,
    h,
    periods,
    totals,
    ctx
  ) {
    const stats =
      getUniqueInvoiceStats(
        periods
      );

    doc.setFillColor(
      248,
      249,
      251
    );

    doc.roundedRect(
      x,
      y,
      w,
      h,
      2,
      2,
      "F"
    );

    doc.setDrawColor(
      220,
      224,
      231
    );

    doc.roundedRect(
      x,
      y,
      w,
      h,
      2,
      2
    );

    setDark(
      doc
    );

    doc.setFont(
      "helvetica",
      "bold"
    );

    doc.setFontSize(
      11
    );

    doc.text(
      "Storage Invoice Overview",
      x + 5,
      y + 9
    );

    const rows =
      [
        [
          "Physical packages",
          String(
            stats.packages
          ),
          false
        ],
        [
          "Stock volume",
          `${formatVolume(
            stats.volume
          )} m³`,
          false
        ],
        [
          "Storage rate",
          `${formatRate(
            ctx.ratePerM3Week
          )} / m³ / week`,
          false
        ],
        [
          "Storage charge",
          formatMoney(
            totals.subtotal
          ),
          false
        ],
        [
          `VAT ${Math.round(
            ctx.vatRate *
            100
          )}%`,
          formatMoney(
            totals.vat
          ),
          false
        ],
        [
          "Invoice total",
          formatMoney(
            totals.total
          ),
          true
        ]
      ];

    let rowY =
      y + 20;

    rows.forEach(
      ([
        label,
        value,
        bold
      ]) => {
        doc.setFont(
          "helvetica",
          bold
            ? "bold"
            : "normal"
        );

        doc.setFontSize(
          bold
            ? 9.5
            : 8.4
        );

        doc.text(
          label,
          x + 5,
          rowY
        );

        doc.text(
          value,
          x + w - 6,
          rowY,
          {
            align:
              "right"
          }
        );

        rowY +=
          bold
            ? 8
            : 7;
      }
    );
  }


  // ==========================================================
  // PAYMENT DETAILS
  // ==========================================================

  function drawPaymentDetails(
    doc,
    y,
    company
  ) {
    doc.setFillColor(
      248,
      249,
      251
    );

    doc.roundedRect(
      14,
      y - 6,
      182,
      58,
      2,
      2,
      "F"
    );

    doc.setDrawColor(
      220,
      224,
      231
    );

    doc.roundedRect(
      14,
      y - 6,
      182,
      58,
      2,
      2
    );

    setDark(
      doc
    );

    doc.setFont(
      "helvetica",
      "bold"
    );

    doc.setFontSize(
      10
    );

    doc.text(
      "Payment Details",
      19,
      y
    );

    doc.setFont(
      "helvetica",
      "normal"
    );

    doc.setFontSize(
      8
    );

    const note =
      splitText(
        doc,
        company.paymentNote ||
        FALLBACK_COMPANY.paymentNote,
        160
      );

    doc.text(
      note.slice(
        0,
        2
      ),
      19,
      y + 9
    );

    const rows =
      [
        [
          "Company Name",
          company.bankCompanyName ||
          company.name
        ],
        [
          "Bank Name",
          company.bankName
        ],
        [
          "Sort Code",
          company.sortCode
        ],
        [
          "Account No.",
          company.accountNo
        ],
        [
          "IBAN",
          company.iban
        ],
        [
          "BIC / SWIFT",
          company.bic
        ]
      ].filter(
        row =>
          cleanText(
            row[1]
          )
      );

    let rowY =
      y + 23;

    rows.forEach(
      ([
        label,
        value
      ]) => {
        doc.setFont(
          "helvetica",
          "bold"
        );

        doc.text(
          label,
          19,
          rowY
        );

        doc.setFont(
          "helvetica",
          "normal"
        );

        doc.text(
          splitText(
            doc,
            value,
            110
          ).slice(
            0,
            1
          ),
          58,
          rowY
        );

        rowY +=
          6;
      }
    );
  }


  // ==========================================================
  // PAGE 1
  // ==========================================================

  function drawPageOne(
    doc,
    invoiceNumber,
    invoiceDate,
    dueDate,
    periods,
    totals,
    ctx,
    logoDataUrl
  ) {
    drawHeader(
      doc,
      "Storage Invoice",
      invoiceNumber,
      invoiceDate,
      dueDate,
      ctx,
      logoDataUrl
    );

    drawBillTo(
      doc,
      92,
      ctx.productOwner
    );

    drawStorageOverview(
      doc,
      110,
      86,
      86,
      70,
      periods,
      totals,
      ctx
    );

    setDark(
      doc
    );

    doc.setFont(
      "helvetica",
      "bold"
    );

    doc.setFontSize(
      11
    );

    doc.text(
      "Invoice Notes",
      14,
      170
    );

    doc.setFont(
      "helvetica",
      "normal"
    );

    doc.setFontSize(
      8.8
    );

    const notes =
      [
        "Storage charges apply to free stock held beyond the four-month grace period.",
        `Charges are calculated at ${formatRate(
          ctx.ratePerM3Week
        )} per m³ per completed week after the grace period.`,
        "Once stock is matched or reserved, no further storage weeks are charged.",
        "A detailed storage charge specification is attached on the following page."
      ];

    let noteY =
      179;

    notes.forEach(
      note => {
        doc.text(
          `• ${note}`,
          14,
          noteY
        );

        noteY +=
          7;
      }
    );

    drawPaymentDetails(
      doc,
      215,
      ctx.company
    );
  }


  // ==========================================================
  // LANDSCAPE SPECIFICATION
  // ==========================================================

  function drawSpecificationTableHeader(
    doc,
    y
  ) {
    const pageWidth =
      doc.internal.pageSize.getWidth();

    doc.setFillColor(
      245,
      245,
      245
    );

    doc.rect(
      12,
      y - 6,
      pageWidth - 24,
      11,
      "F"
    );

    setDark(
      doc
    );

    doc.setFont(
      "helvetica",
      "bold"
    );

    doc.setFontSize(
      7
    );

    doc.text(
      "SKU",
      14,
      y
    );

    doc.text(
      "Product",
      38,
      y
    );

    doc.text(
      "Inbound",
      102,
      y
    );

    doc.text(
      "Grace End",
      125,
      y
    );

    doc.text(
      "Prev. Weeks",
      149,
      y
    );

    doc.text(
      "This Invoice",
      174,
      y
    );

    doc.text(
      "Packages",
      199,
      y
    );

    doc.text(
      "Volume m³",
      221,
      y
    );

    doc.text(
      "Rate",
      244,
      y
    );

    doc.text(
      "Charge",
      pageWidth - 14,
      y,
      {
        align:
          "right"
      }
    );

    doc.setDrawColor(
      90,
      90,
      90
    );

    doc.line(
      12,
      y + 5,
      pageWidth - 12,
      y + 5
    );

    return y + 12;
  }


  function addLandscapeSpecificationPage(
    doc,
    invoiceNumber,
    invoiceDate,
    dueDate,
    ctx,
    logoDataUrl
  ) {
    doc.addPage(
      "a4",
      "landscape"
    );

    drawHeader(
      doc,
      "Storage Specification",
      invoiceNumber,
      invoiceDate,
      dueDate,
      ctx,
      logoDataUrl
    );

    return drawSpecificationTableHeader(
      doc,
      88
    );
  }


  function drawSpecificationPages(
    doc,
    specificationLines,
    invoiceNumber,
    invoiceDate,
    dueDate,
    totals,
    ctx,
    logoDataUrl
  ) {
    let y =
      addLandscapeSpecificationPage(
        doc,
        invoiceNumber,
        invoiceDate,
        dueDate,
        ctx,
        logoDataUrl
      );

    const pageHeight =
      210;

    specificationLines.forEach(
      line => {
        if (
          y >
          pageHeight - 35
        ) {
          y =
            addLandscapeSpecificationPage(
              doc,
              invoiceNumber,
              invoiceDate,
              dueDate,
              ctx,
              logoDataUrl
            );
        }

        setDark(
          doc
        );

        doc.setFontSize(
          7
        );

        doc.setFont(
          "helvetica",
          "bold"
        );

        doc.text(
          cleanText(
            line.sku_base
          ),
          14,
          y
        );

        doc.setFont(
          "helvetica",
          "normal"
        );

        const productLines =
          splitText(
            doc,
            line.product_name ||
            "—",
            58
          );

        doc.text(
          productLines.slice(
            0,
            2
          ),
          38,
          y
        );

        doc.text(
          formatDate(
            line.inbound_date
          ),
          102,
          y
        );

        doc.text(
          formatDate(
            line.grace_period_end
          ),
          125,
          y
        );

        doc.text(
          String(
            line.previous_weeks
          ),
          158,
          y,
          {
            align:
              "center"
          }
        );

        doc.text(
          String(
            line.this_invoice_weeks
          ),
          184,
          y,
          {
            align:
              "center"
          }
        );

        doc.text(
          String(
            line.packages
          ),
          207,
          y,
          {
            align:
              "center"
          }
        );

        doc.text(
          formatVolume(
            line.volume_m3
          ),
          235,
          y,
          {
            align:
              "right"
          }
        );

        doc.text(
          formatRate(
            line.rate
          ),
          258,
          y,
          {
            align:
              "right"
          }
        );

        doc.setFont(
          "helvetica",
          "bold"
        );

        doc.text(
          formatMoney(
            line.amount
          ),
          283,
          y,
          {
            align:
              "right"
          }
        );

        doc.setFont(
          "helvetica",
          "normal"
        );

        const rowHeight =
          Math.max(
            8,
            productLines.length *
            4
          );

        y +=
          rowHeight;
      }
    );


    // --------------------------------------------------------
    // SPECIFICATION TOTAL
    // --------------------------------------------------------

    if (
      y >
      pageHeight - 45
    ) {
      y =
        addLandscapeSpecificationPage(
          doc,
          invoiceNumber,
          invoiceDate,
          dueDate,
          ctx,
          logoDataUrl
        );
    }

    y +=
      4;

    doc.setDrawColor(
      90,
      90,
      90
    );

    doc.line(
      195,
      y,
      283,
      y
    );

    y +=
      9;

    doc.setFont(
      "helvetica",
      "normal"
    );

    doc.setFontSize(
      8
    );

    doc.text(
      "Storage charges excl. VAT",
      220,
      y
    );

    doc.text(
      formatMoney(
        totals.subtotal
      ),
      283,
      y,
      {
        align:
          "right"
      }
    );

    y +=
      7;

    doc.text(
      `VAT ${Math.round(
        ctx.vatRate *
        100
      )}%`,
      220,
      y
    );

    doc.text(
      formatMoney(
        totals.vat
      ),
      283,
      y,
      {
        align:
          "right"
      }
    );

    y +=
      8;

    doc.setFont(
      "helvetica",
      "bold"
    );

    doc.setFontSize(
      9
    );

    doc.text(
      "Invoice Total",
      220,
      y
    );

    doc.text(
      formatMoney(
        totals.total
      ),
      283,
      y,
      {
        align:
          "right"
      }
    );
  }


  // ==========================================================
  // CREATE PDF
  // ==========================================================

  async function createPdfBlob(
    invoiceNumber,
    periods,
    specificationLines,
    ctx
  ) {
    if (
      !window.jspdf?.jsPDF
    ) {
      throw new Error(
        "jsPDF is not loaded. Add jsPDF before storage-invoice-generator.js."
      );
    }

    const {
      jsPDF
    } =
      window.jspdf;

    /*
     * Eerste pagina portrait.
     */
    const doc =
      new jsPDF({
        orientation:
          "portrait",

        unit:
          "mm",

        format:
          "a4"
      });

    const invoiceDate =
      new Date();

    const dueDate =
      addDays(
        invoiceDate,
        ctx.paymentTermDays
      );

    const totals =
      calculateTotals(
        periods,
        ctx.vatRate
      );

    const logoDataUrl =
      await urlToDataUrl(
        ctx.company.logoUrl
      );

    drawPageOne(
      doc,
      invoiceNumber,
      invoiceDate,
      dueDate,
      periods,
      totals,
      ctx,
      logoDataUrl
    );

    /*
     * Pagina 2+ landscape.
     */
    drawSpecificationPages(
      doc,
      specificationLines,
      invoiceNumber,
      invoiceDate,
      dueDate,
      totals,
      ctx,
      logoDataUrl
    );

    /*
     * Footer pas op het einde zodat Page X of Y klopt.
     */
    drawFooter(
      doc,
      ctx.company
    );

    return {
      blob:
        doc.output(
          "blob"
        ),

      totals,

      invoiceDate,

      dueDate
    };
  }


  // ==========================================================
  // UPLOAD PDF
  // ==========================================================

  async function uploadPdf(
    client,
    companyId,
    invoiceNumber,
    blob
  ) {
    const fileName =
      `${safeFilePart(
        invoiceNumber
      )}.pdf`;

    const storagePath =
      `${companyId}/invoices/${fileName}`;

    const {
      error
    } =
      await client.storage
        .from(
          DOCUMENT_BUCKET
        )
        .upload(
          storagePath,
          blob,
          {
            contentType:
              "application/pdf",

            upsert:
              true
          }
        );

    if (error) {
      throw error;
    }

    const {
      data
    } =
      client.storage
        .from(
          DOCUMENT_BUCKET
        )
        .getPublicUrl(
          storagePath
        );

    return {
      storagePath,

      fileUrl:
        data?.publicUrl ||
        ""
    };
  }


  // ==========================================================
  // CREATE INVOICE RECORD
  // ==========================================================

  async function createInvoiceRecord(
    client,
    companyId,
    customerId,
    invoiceNumber,
    uploaded,
    pdfResult
  ) {
    const {
      totals,
      invoiceDate,
      dueDate
    } =
      pdfResult;

    const {
      data,
      error
    } =
      await client
        .from(
          "invoices"
        )
        .insert({
          company_id:
            companyId,

          customer_id:
            customerId,

          invoice_number:
            invoiceNumber,

          invoice_type:
            "storage",

          invoice_date:
            dateKey(
              invoiceDate
            ),

          due_date:
            dateKey(
              dueDate
            ),

          subtotal:
            totals.subtotal,

          vat_amount:
            totals.vat,

          total_amount:
            totals.total,

          storage_path:
            uploaded.storagePath,

          file_url:
            uploaded.fileUrl,

          status:
            "generated"
        })
        .select(
          "id"
        )
        .single();

    if (error) {
      throw error;
    }

    return data.id;
  }


  // ==========================================================
  // STORE INVOICED PERIODS
  // ==========================================================

  async function createStorageChargePeriods(
  client,
  companyId,
  customerId,
  invoiceId,
  periods
) {

  const rows =
    (
      periods ||
      []
    ).map(
      period => ({

        company_id:
          companyId,

        customer_id:
          customerId,

        invoice_id:
          invoiceId,

        item_id:
          period.item_id,

        product_id:
          period.product_id,

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
          round3(
            period.volume_m3
          ),

        rate_per_m3_week:
          toNumber(
            period.rate_per_m3_week,
            DEFAULT_STORAGE_RATE
          ),

        /*
         * BELANGRIJK:
         *
         * Niet meer:
         *
         * round2(period.amount_ex_vat)
         *
         * We bewaren bijvoorbeeld 0.648.
         */
        amount_ex_vat:
          Number(
            toNumber(
              period.amount_ex_vat,
              0
            ).toFixed(
              6
            )
          ),

        status:
          "invoiced"
      })
    );


  if (
    !rows.length
  ) {

    throw new Error(
      "No storage charge periods found for invoice."
    );
  }


  const {
    error
  } =
    await client
      .from(
        "storage_charge_periods"
      )
      .insert(
        rows
      );


  if (error) {
    throw error;
  }
}


  // ==========================================================
  // OPTIONAL SYSTEM NOTIFICATION
  //
  // Hiermee verschijnt de nieuwe invoice ook als notification.
  // Dit maakt hem niet afhankelijk van orders.
  // ==========================================================

  async function createStorageInvoiceNotification(
    client,
    companyId,
    customerId,
    invoiceId,
    invoiceNumber,
    uploaded
  ) {
    try {
      const {
        error
      } =
        await client
          .from(
            "system_notifications"
          )
          .insert({
            company_id:
              companyId,

            customer_id:
              customerId,

            recipient_profile_id:
              null,

            recipient_role:
              null,

            notification_type:
              "invoice_generated",

            title:
              "New Storage Invoice Available",

            message:
              `Storage invoice ${invoiceNumber} has been generated and is now available.`,

            severity:
              "info",

            entity_type:
              "invoice",

            entity_id:
              invoiceId,

            action_url:
              uploaded.fileUrl ||
              "./billing.html",

            is_read:
              false,

            popup_shown:
              false
          });

      if (error) {
        throw error;
      }

    } catch (error) {
      /*
       * Notification mag nooit de factuurgeneratie blokkeren.
       */
      console.warn(
        "Storage invoice notification skipped:",
        error.message
      );
    }
  }


  // ==========================================================
  // BEST-EFFORT ROLLBACK
  // ==========================================================

  async function rollbackFailedInvoice(
    client,
    invoiceId,
    storagePath
  ) {
    if (
      invoiceId
    ) {
      try {
        await client
          .from(
            "invoices"
          )
          .delete()
          .eq(
            "id",
            invoiceId
          );
      } catch (error) {
        console.warn(
          "Storage invoice rollback invoice delete failed:",
          error.message
        );
      }
    }

    if (
      storagePath
    ) {
      try {
        await client.storage
          .from(
            DOCUMENT_BUCKET
          )
          .remove([
            storagePath
          ]);
      } catch (error) {
        console.warn(
          "Storage invoice rollback PDF delete failed:",
          error.message
        );
      }
    }
  }


  // ==========================================================
  // MAIN GENERATE FUNCTION
  //
  // Wordt aangeroepen vanuit storage-invoicing.js:
  //
  // StorageInvoiceGenerator.generate({
  //   client,
  //   companyId,
  //   customerId,
  //   periods,
  //   lines,
  //   ...
  // })
  // ==========================================================

  async function generate(options = {}) {
    const client =
      options.client;

    const companyId =
      options.companyId;

    const customerId =
      options.customerId;

    const periods =
      Array.isArray(
        options.periods
      )
        ? options.periods
        : [];

    const inputLines =
      Array.isArray(
        options.lines
      )
        ? options.lines
        : [];

    if (!client) {
      throw new Error(
        "Supabase client is missing."
      );
    }

    if (!companyId) {
      throw new Error(
        "Company ID is missing."
      );
    }

    if (!customerId) {
      throw new Error(
        "Product Owner/customer ID is missing."
      );
    }

    if (
      !periods.length
    ) {
      throw new Error(
        "There are no storage periods to invoice."
      );
    }


    // --------------------------------------------------------
    // SETTINGS + CUSTOMER
    // --------------------------------------------------------

    const ctx =
      await loadCompanySettings(
        client,
        companyId
      );

    ctx.productOwner =
      await loadProductOwnerProfile(
        client,
        customerId
      );

    ctx.ratePerM3Week =
      toNumber(
        options.ratePerM3Week,
        DEFAULT_STORAGE_RATE
      );

    ctx.vatRate =
      toNumber(
        options.vatRate,
        ctx.vatRate ||
        DEFAULT_VAT_RATE
      );


    // --------------------------------------------------------
    // HISTORIC INVOICED WEEKS
    // --------------------------------------------------------

    const previousPeriods =
      await loadPreviouslyInvoicedPeriods(
        client,
        companyId,
        customerId
      );

    /*
     * Bescherming tegen dubbel factureren.
     */
    validatePeriodsNotAlreadyInvoiced(
      periods,
      previousPeriods
    );


    // --------------------------------------------------------
    // BUILD PDF SPECIFICATION
    // --------------------------------------------------------

    const specificationLines =
      buildSpecificationLines(
        periods,
        previousPeriods,
        inputLines
      );

    if (
      !specificationLines.length
    ) {
      throw new Error(
        "Storage invoice specification could not be created."
      );
    }


    // --------------------------------------------------------
    // RESERVE NORMAL INV NUMBER
    // --------------------------------------------------------

    const invoiceNumber =
      await reserveNextInvoiceNumber(
        client,
        companyId,
        ctx.invoicePrefix
      );


    let uploaded =
      null;

    let invoiceId =
      null;


    try {
      // ------------------------------------------------------
      // PDF
      // ------------------------------------------------------

      const pdfResult =
        await createPdfBlob(
          invoiceNumber,
          periods,
          specificationLines,
          ctx
        );


      // ------------------------------------------------------
      // UPLOAD
      // ------------------------------------------------------

      uploaded =
        await uploadPdf(
          client,
          companyId,
          invoiceNumber,
          pdfResult.blob
        );

      if (
        !uploaded.fileUrl ||
        !uploaded.storagePath
      ) {
        throw new Error(
          "Storage invoice PDF was uploaded but no URL/storage path was returned."
        );
      }


      // ------------------------------------------------------
      // INVOICE
      // ------------------------------------------------------

      invoiceId =
        await createInvoiceRecord(
          client,
          companyId,
          customerId,
          invoiceNumber,
          uploaded,
          pdfResult
        );


      // ------------------------------------------------------
      // STORAGE PERIODS
      //
      // Pas HIER worden de weken werkelijk als invoiced
      // geregistreerd.
      // ------------------------------------------------------

      await createStorageChargePeriods(
        client,
        companyId,
        customerId,
        invoiceId,
        periods
      );


      // ------------------------------------------------------
      // NOTIFICATION
      // ------------------------------------------------------

      await createStorageInvoiceNotification(
        client,
        companyId,
        customerId,
        invoiceId,
        invoiceNumber,
        uploaded
      );


      // ------------------------------------------------------
      // RESULT
      // ------------------------------------------------------

      return {
        invoiceId,
        invoiceNumber,

        storagePath:
          uploaded.storagePath,

        fileUrl:
          uploaded.fileUrl,

        subtotal:
          pdfResult.totals.subtotal,

        vat:
          pdfResult.totals.vat,

        total:
          pdfResult.totals.total,

        specificationLines
      };

    } catch (error) {
      /*
       * Als bijvoorbeeld storage_charge_periods niet opgeslagen
       * kunnen worden, proberen we de half aangemaakte invoice
       * en PDF weer te verwijderen.
       */
      await rollbackFailedInvoice(
        client,
        invoiceId,
        uploaded?.storagePath ||
        null
      );

      throw error;
    }
  }


  // ==========================================================
  // PUBLIC API
  // ==========================================================

  window.StorageInvoiceGenerator = {
    generate
  };

})();