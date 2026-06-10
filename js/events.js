(function(){

"use strict";

function byId(id){
  return document.getElementById(id);
}

function toast(msg,type="ok"){

  const el = byId("toast");

  el.textContent = msg;
  el.className = "notice "+type;

  setTimeout(()=>{
    el.textContent="";
    el.className="notice";
  },4000)

}

async function loadEvents(){

  const client = sb()

  const {data,error} = await client
  .from("warehouse_events")
  .select("*")
  .order("created_at",{ascending:false})
  .limit(200)

  if(error){
    toast(error.message,"error")
    return
  }

  renderEvents(data)

}

function renderEvents(rows){

  const tbody = byId("eventsBody")
  tbody.innerHTML=""

  rows.forEach(row=>{

    const tr=document.createElement("tr")

    const time = new Date(row.created_at).toLocaleString()

    tr.innerHTML = `
    <td>${time}</td>
    <td>${row.event_type}</td>
    <td>${row.entity_type}</td>
  <td>
  ${row.reference_no ?? "-"}
  ${
    row.payload?.order_number
      ? `<span class="subline">Order: ${row.payload.order_number}</span>`
      : ""
  }
  ${
    row.payload?.supplier_reference || row.payload?.external_reference
      ? `<span class="subline">Supplier Ref: ${row.payload.supplier_reference || row.payload.external_reference}</span>`
      : ""
  }
</td>
    <td>${row.source_module ?? "-"}</td>
    <td>${row.old_status ?? ""} → ${row.new_status ?? ""}</td>
    `

    tbody.appendChild(tr)

  })

}

function init(){

  byId("btnRefresh").onclick = loadEvents

  loadEvents()

}

document.addEventListener("DOMContentLoaded",init)

})();
