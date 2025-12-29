<script>
(() => {
  const showErr = (msg) => {
    const el = document.getElementById("status");
    if (el) el.textContent = "BŁĄD: " + msg;
  };
  window.addEventListener("error", (e) => showErr(e.message || "Nieznany błąd JS"));
  window.addEventListener("unhandledrejection", (e) => {
    showErr((e.reason && e.reason.message) ? e.reason.message : String(e.reason || "Promise error"));
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/czas-pracy-pwa/sw.js", { scope: "/czas-pracy-pwa/" });
  }

  const $ = (id) => document.getElementById(id);
  const pad2 = (n) => String(n).padStart(2,"0");

  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
  };
  const ym = (dateISO) => dateISO.slice(0,7);

  const MON = ["sty","lut","mar","kwi","maj","cze","lip","sie","wrz","paź","lis","gru"];
  const fmtDMYText = (dateISO) => {
    if (!dateISO) return "";
    const [y,m,d] = dateISO.split("-").map(Number);
    return `${pad2(d)}-${MON[m-1]}-${y}`;
  };

  const fmtMonthPL = (monthYM) => {
    const [Y, M] = monthYM.split("-").map(Number);
    const dt = new Date(Y, M-1, 1);
    const s = new Intl.DateTimeFormat("pl-PL", { month:"long", year:"numeric" }).format(dt);
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  const fmtWeekdayPL = (dateISO) => {
    const [Y, M, D] = dateISO.split("-").map(Number);
    const dt = new Date(Y, M-1, D);
    const s = new Intl.DateTimeFormat("pl-PL", { weekday:"long" }).format(dt);
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  const STORAGE_KEY = "worktime_pwa_v1";
  let db = load() || { settings:{ rate:40 }, entries:[] };

  function save(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); }
  function load(){ try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; } }

  // migracja: {date,start,end,note} => {date, shifts:[{start,end}], note}
  function migrateIfNeeded(){
    let changed = false;
    db.entries = (Array.isArray(db.entries) ? db.entries : []).map(e=>{
      if (!e) return e;
      if (Array.isArray(e.shifts)) return e;
      const shifts = [];
      if (e.start && e.end) shifts.push({ start:e.start, end:e.end });
      const ne = { date:e.date, note:e.note || "", shifts };
      changed = true;
      return ne;
    });
    if (changed) save();
  }

  function normalize(){
    db.settings = db.settings || {};
    db.settings.rate = Number(db.settings.rate ?? 40);
    db.entries = Array.isArray(db.entries) ? db.entries : [];
    for (const e of db.entries){
      e.shifts = Array.isArray(e.shifts) ? e.shifts : [];
      e.note = e.note || "";
    }
  }

  function setStatus(t){ const el = $("status"); if (el) el.textContent = t || ""; }

  function minutesBetween(dateISO, start, end) {
    const [y,m,d] = dateISO.split("-").map(Number);
    const [sh,sm] = start.split(":").map(Number);
    const [eh,em] = end.split(":").map(Number);
    const a = new Date(y,m-1,d,sh,sm,0,0);
    let b = new Date(y,m-1,d,eh,em,0,0);
    if (b < a) b = new Date(y,m-1,d+1,eh,em,0,0);
    return Math.round((b-a)/60000);
  }

  function fmtHM(mins){
    const h = Math.floor(mins/60);
    const m = mins%60;
    return `${h}:${pad2(m)}`;
  }
  function pln(x){ return x.toLocaleString("pl-PL",{style:"currency",currency:"PLN"}); }

  function readSettingsFromUI(){ db.settings.rate = Number($("rate").value || 0); }
  function hydrateSettingsUI(){ $("rate").value = db.settings.rate; }

  function getDay(date){ return db.entries.find(e => e.date === date) || null; }

  function upsertDay(date, patch){
    const i = db.entries.findIndex(e => e.date === date);
    if (i >= 0) db.entries[i] = { ...db.entries[i], ...patch };
    else db.entries.push({ date, note:"", shifts:[], ...patch });
    db.entries.sort((a,b)=>a.date.localeCompare(b.date));
  }

  function deleteDay(dateISO){ db.entries = db.entries.filter(e => e.date !== dateISO); }

  function computeDayMinutes(day){
    let total = 0;
    for (const s of day.shifts){
      if (!s?.start || !s?.end) continue;
      total += Math.max(0, minutesBetween(day.date, s.start, s.end));
    }
    return total;
  }

  function computeMonthMinutes(monthYM){
    const days = db.entries.filter(e => ym(e.date) === monthYM);
    return days.reduce((acc, d)=> acc + computeDayMinutes(d), 0);
  }

  // ===== KALENDARZ =====
  const DOW = ["Pn","Wt","Śr","Czw","Pt","Sb","Nd"];
  function mondayIndex(jsDay){ return (jsDay + 6) % 7; }
  function daysInMonth(year, month1){ return new Date(year, month1, 0).getDate(); }

  function renderDow(){
    $("dowRow").innerHTML = DOW.map(d => `<div class="calDow">${d}</div>`).join("");
  }

  function renderCalendar(monthYM){
    $("monthLabelText").textContent = fmtMonthPL(monthYM);

    const [Y, M] = monthYM.split("-").map(Number);
    const first = new Date(Y, M-1, 1);
    const firstIdx = mondayIndex(first.getDay());
    const dim = daysInMonth(Y, M);

    const cells = [];

    for (let i=0;i<firstIdx;i++){
      cells.push(`<div class="blankCell"></div>`);
    }

    for (let d=1; d<=dim; d++){
      const dateISO = `${Y}-${pad2(M)}-${pad2(d)}`;
      const jsDow = new Date(Y, M-1, d).getDay();
      const isWeekend = (jsDow === 0 || jsDow === 6);

      const day = getDay(dateISO);
      const shiftsCount = (day?.shifts || []).length;
      const hasShifts = shiftsCount > 0;
      const hasNote = !!(day?.note && day.note.trim());

      const numClass = [
        "dayNum",
        isWeekend ? "weekend" : "",
        hasShifts ? "has" : ""
      ].filter(Boolean).join(" ");

      cells.push(`
        <div class="dayCell" data-date="${dateISO}">
          <div class="dayTop">
            <div class="${numClass}">${d}</div>
          </div>
          <div class="indRow" aria-hidden="true">
            <span class="dot shift ${hasShifts ? "" : "hidden"}" title="${hasShifts ? "Są godziny" : ""}"></span>
            <span class="dot note ${hasNote ? "" : "hidden"}" title="${hasNote ? "Jest notatka" : ""}"></span>
          </div>
        </div>
      `);
    }

    const mod = cells.length % 7;
    if (mod !== 0){
      const need = 7 - mod;
      for (let i=0;i<need;i++) cells.push(`<div class="blankCell"></div>`);
    }

    $("calGrid").innerHTML = cells.join("");

    document.querySelectorAll(".dayCell[data-date]").forEach(el=>{
      el.onclick = ()=>{
        const date = el.getAttribute("data-date");
        openDay(date);
      };
    });
  }

  // ===== MODAL DNIA =====
  const dlg = $("dayDialog");
  let dlgDate = null;

  function openDay(dateISO){
    dlgDate = dateISO;
    $("date").value = dateISO;

    const weekday = fmtWeekdayPL(dateISO);
    $("dlgTitle").textContent = `${fmtDMYText(dateISO)}`;
    $("dlgMeta").textContent = weekday;

    const day = getDay(dateISO) || { date: dateISO, note:"", shifts:[] };
    $("dlgStart").value = "";
    $("dlgEnd").value = "";
    $("dlgNote").value = day.note || "";

    renderDayDialog();

    if (dlg && typeof dlg.showModal === "function") dlg.showModal();
    else if (dlg) dlg.setAttribute("open","");
  }

  function closeDay(){
    dlgDate = null;
    if (dlg && typeof dlg.close === "function") dlg.close();
    else if (dlg) dlg.removeAttribute("open");
  }

  function renderDayDialog(){
    const day = getDay(dlgDate) || { date: dlgDate, note:"", shifts:[] };
    const mins = computeDayMinutes(day);
    const pay = (mins/60) * (db.settings.rate||0);

    $("dlgSumHM").textContent = fmtHM(mins);
    $("dlgSumPay").textContent = pln(pay);
    $("dlgSummary").textContent = `Zakresy: ${day.shifts.length || 0}`;

    const items = (day.shifts || []).map((s, idx)=>{
      const a = s.start || "—";
      const b = s.end || "—";
      const m = (s.start && s.end) ? Math.max(0, minutesBetween(day.date, s.start, s.end)) : 0;

      return `
        <div class="shiftItem">
          <div>
            <div class="times">${a} – ${b}</div>
            <div class="mins">${m ? ("Czas: " + fmtHM(m)) : "-"}</div>
          </div>
          <button class="miniBtn danger" data-delshift="${idx}">Usuń zakres</button>
        </div>
      `;
    }).join("");

    $("dlgShifts").innerHTML = items || `<div class="muted">Brak zakresów. Dodaj pierwszy powyżej.</div>`;

    document.querySelectorAll("[data-delshift]").forEach(btn=>{
      btn.onclick = ()=>{
        const idx = Number(btn.getAttribute("data-delshift"));
        if (!confirm("Usunąć ten zakres?")) return;
        const d = getDay(dlgDate);
        if (!d) return;
        d.shifts.splice(idx, 1);
        save();
        renderAll();
        renderDayDialog();
      };
    });
  }

  // ===== TOTALS =====
  function renderTotals(monthYM){
    const sumMin = computeMonthMinutes(monthYM);
    $("sumHours").textContent = fmtHM(sumMin);
    $("sumPay").textContent = pln((sumMin/60) * (db.settings.rate||0));
  }

  function renderAll(){
    normalize();
    readSettingsFromUI();
    save();

    const monthYM = $("monthPick").value || ym(todayISO());
    renderDow();
    renderCalendar(monthYM);
    renderTotals(monthYM);
  }

  // ===== EVENTY UI =====
  $("addShiftBtn").onclick = ()=>{
    const date = $("date").value;
    const start = $("start").value;
    const end = $("end").value;
    const note = ($("note").value || "").trim();

    if (!date) return alert("Wybierz datę.");
    if ((start && !end) || (!start && end)) return alert("Uzupełnij wejście i wyjście (albo zostaw oba puste).");
    if (!start && !end && !note) return alert("Wpisz godziny lub notatkę.");

    const day = getDay(date) || { date, note:"", shifts:[] };

    let msg = [];
    if (start && end){
      day.shifts.push({ start, end });
      msg.push("Dodano zakres.");
      $("start").value = "";
      $("end").value = "";
    }
    if (note){
      day.note = note;
      msg.push("Zapisano notatkę.");
    }

    upsertDay(date, day);
    setStatus(msg.join(" ") || "Zapisano.");
    save();
    renderAll();
  };

  $("openDayBtn").onclick = ()=>{
    const date = $("date").value;
    if (!date) return alert("Wybierz datę.");
    openDay(date);
  };

  $("dlgClose").onclick = closeDay;
  if (dlg) dlg.addEventListener("cancel", (e)=>{ e.preventDefault(); closeDay(); });

  $("dlgAddShift").onclick = ()=>{
    if (!dlgDate) return;
    const start = $("dlgStart").value;
    const end = $("dlgEnd").value;
    if (!start || !end) return alert("Uzupełnij wejście i wyjście.");

    const day = getDay(dlgDate) || { date: dlgDate, note:"", shifts:[] };
    day.shifts.push({ start, end });
    upsertDay(dlgDate, day);

    $("dlgStart").value = "";
    $("dlgEnd").value = "";
    save();
    renderAll();
    renderDayDialog();
  };

  $("dlgSaveNote").onclick = ()=>{
    if (!dlgDate) return;
    const note = ($("dlgNote").value || "").trim();
    const day = getDay(dlgDate) || (getDay(dlgDate) || { date: dlgDate, note:"", shifts:[] });
    day.note = note;
    upsertDay(dlgDate, day);
    save();
    renderAll();
    renderDayDialog();
    setStatus("Zapisano notatkę.");
  };

  $("dlgDeleteDay").onclick = ()=>{
    if (!dlgDate) return;
    if (!confirm("Usunąć cały dzień (wszystkie zakresy i notatkę)?")) return;
    deleteDay(dlgDate);
    save();
    closeDay();
    renderAll();
  };

  // miesiąc
  $("monthBar").onclick = ()=>{
    const input = $("monthPick");
    if (!input) return;
    if (typeof input.showPicker === "function") input.showPicker();
    else input.focus();
  };
  $("monthPick").addEventListener("change", renderAll);

  // narzędzia
  $("printPdfBtn").onclick = ()=> window.print();

  $("backupJson").onclick = ()=>{
    const blob = new Blob([JSON.stringify(db,null,2)], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `czas-pracy-backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  $("restoreBtn").onclick = ()=> $("restoreJson").click();
  $("restoreJson").onchange = async (ev)=>{
    const f = ev.target.files?.[0];
    if (!f) return;
    try{
      const txt = await f.text();
      const obj = JSON.parse(txt);
      db = obj;
      normalize();
      migrateIfNeeded();
      save();
      hydrateSettingsUI();
      renderAll();
      setStatus("Przywrócono dane z pliku JSON.");
    }catch{
      alert("Nie udało się wczytać pliku JSON.");
    }
  };

  $("clearMonth").onclick = ()=>{
    const monthYM = $("monthPick").value || ym(todayISO());
    if (!confirm("Usunąć wszystkie wpisy z tego miesiąca?")) return;
    db.entries = db.entries.filter(e => ym(e.date) !== monthYM);
    save();
    renderAll();
  };

  ["rate"].forEach(id=>{
    $(id).addEventListener("input", renderAll);
    $(id).addEventListener("change", renderAll);
  });

  // INIT
  try{
    normalize();
    migrateIfNeeded();
    hydrateSettingsUI();
    $("date").value = todayISO();
    $("monthPick").value = ym(todayISO());
    renderAll();
  } catch(err){
    const msg = (err && err.message) ? err.message : String(err);
    const el = document.getElementById("status");
    if (el) el.textContent = "BŁĄD INIT: " + msg;
  }
})();
</script>
