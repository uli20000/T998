/* T998 ByDate／ByOrder: archive the original workbooks in private Supabase Storage before importing parsed rows. */
(() => {
  const byDateColumns = ["訂單號碼", "ID（門市名稱／代號）", "訂單日期", "指派時間", "QT", "留店時間", "外送時間（去）", "外送達成時間（D30)", "外出時間 (車程)", "完成整張外送時間", "距離"];
  const byOrderColumns = ["reg order id", "RC", "AC", "ID", "訂單", "自動/手動", "落單時間", "預計送達時間", "原預計送達時間", "指派時間", "門市到達時間", "外送出發", "到達時間", "到店時間", "外送員留店時間", "遲到時間", "Quote Time", "配送費", "餐點金額", "結算金額", "距離", "外送員", "D7", "D25"];
  const bucket = "t998-score-source-archive";
  const input = document.getElementById("t998ScoreSourceFiles");
  const fileLabel = document.getElementById("t998ScoreSourceFilesLabel");
  const preview = document.getElementById("t998ScoreSourcePreview");
  const button = document.getElementById("t998ScoreSourceImport");
  const message = document.getElementById("t998ScoreSourceMessage");
  if (!input || !button || !preview || !message) return;
  let prepared = [];

  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function validIsoDate(year, month, day) {
    const value = new Date(Date.UTC(year, month - 1, day));
    return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day
      ? `${String(year).padStart(4,"0")}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}` : "";
  }
  function dateIso(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return validIsoDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
    if (typeof value === "number" && window.XLSX?.SSF?.parse_date_code) {
      const date = XLSX.SSF.parse_date_code(value);
      return date?.y && date?.m && date?.d ? validIsoDate(date.y, date.m, date.d) : "";
    }
    const text = String(value ?? "").trim();
    let match = text.match(/^(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/);
    if (match) return validIsoDate(+match[1], +match[2], +match[3]);
    match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](20\d{2})/);
    return match ? validIsoDate(+match[3], +match[1], +match[2]) : "";
  }
  function workbookDateFromName(name) {
    const matches = [...String(name).matchAll(/20\d{2}[.-]\d{2}[.-]\d{2}/g)].map(x => dateIso(x[0]));
    return matches.length === 1 ? matches[0] : "";
  }
  function xlsxValue(value) {
    if (!(value instanceof Date)) return value;
    const localDate = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
    return localDate.toISOString().slice(0,19).replace("T"," ");
  }
  async function parseFile(file) {
    if (!window.XLSX) throw new Error("Excel 元件尚未載入，請重新整理後再試。");
    if (!/\.(xlsx|xls|xlsm)$/i.test(file.name)) throw new Error("只接受 Excel 檔案。");
    if (!file.size || file.size > 50 * 1024 * 1024) throw new Error("檔案不可空白，且大小需在 50 MB 以內。");
    const workbook = XLSX.read(await file.arrayBuffer(), {type:"array", cellDates:true});
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error("檔案沒有工作表。");
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {header:1, defval:"", raw:true});
    if (!matrix.length) throw new Error("工作表沒有資料。");
    const headers = matrix[0].map(v => String(v ?? "").trim());
    const lowerHeaders = headers.map(v => v.toLowerCase());
    let type = "";
    if (headers.includes("訂單號碼") && headers.some(v => v.includes("門市名稱／代號")) && headers.includes("QT")) type = "ByDate";
    else if (lowerHeaders.includes("reg order id") && headers.includes("落單時間") && headers.includes("D25")) type = "ByOrder";
    else throw new Error("無法辨識報表格式；請選 ByDate 或 ByOrder Excel。");
    const allowed = type === "ByDate" ? byDateColumns : byOrderColumns;
    const indices = allowed.map(name => headers.indexOf(name));
    const orderHeader = type === "ByDate" ? "訂單號碼" : "reg order id";
    const dateHeader = type === "ByDate" ? "訂單日期" : "落單時間";
    const restaurantHeader = type === "ByDate" ? "ID（門市名稱／代號）" : "ID";
    const fileDate = workbookDateFromName(file.name);
    const rows = [];
    matrix.slice(1).forEach((cells, index) => {
      if (!cells.some(v => v !== "" && v !== null && v !== undefined)) return;
      const payload = {};
      indices.forEach((column, i) => {
        if (column < 0) return;
        const value = cells[column];
        if (value !== "" && value !== null && value !== undefined) payload[allowed[i]] = xlsxValue(value);
      });
      const orderNumber = String(payload[orderHeader] ?? "").trim();
      const restaurantRaw = String(payload[restaurantHeader] ?? "").trim();
      const codeMatch = (type === "ByDate" ? restaurantRaw : orderNumber).match(/(?:TWI|TWB)(\d{3})/i);
      const recordDate = dateIso(cells[headers.indexOf(dateHeader)]) || fileDate;
      rows.push({row_number:index + 2, record_date:recordDate, store_code:codeMatch?.[1] || "", restaurant_name:type === "ByDate" ? restaurantRaw.split(/[/／]/)[0].trim() : restaurantRaw, order_number:orderNumber, payload});
    });
    if (type === "ByOrder") {
      const courierIds = new Map(), courierOrders = new Map(), dispatchWaves = new Map();
      for (const row of rows) {
        const payload = row.payload || {}, courierName = String(payload["外送員"] ?? "").trim(), assigned = String(payload["指派時間"] ?? "").trim().replace("T"," ").slice(0,19);
        delete payload["外送員"];
        if (!courierName || String(payload["自動/手動"] || "").trim() === "第三方") continue;
        const key = `${row.record_date}|${courierName.toLocaleLowerCase()}`;
        if (!courierIds.has(key)) courierIds.set(key, window.crypto?.randomUUID?.() || `courier-${courierIds.size + 1}`);
        const courierId = courierIds.get(key); payload._courier_day_id = courierId;
        const riderOrders = courierOrders.get(courierId) || []; riderOrders.push(row); courierOrders.set(courierId, riderOrders);
        if (assigned) { const waveKey = `${row.record_date}|${courierId}|${assigned}`, wave = dispatchWaves.get(waveKey) || []; wave.push(row); dispatchWaves.set(waveKey, wave); }
      }
      for (const riderOrders of courierOrders.values()) {
        const stores = new Set(riderOrders.map(row => row.store_code).filter(Boolean)).size;
        for (const row of riderOrders) row.payload._courier_day_store_count = stores;
      }
      for (const wave of dispatchWaves.values()) {
        const stores = new Set(wave.map(row => row.store_code).filter(Boolean)).size;
        for (const row of wave) { row.payload._dispatch_wave_size = wave.length; row.payload._dispatch_wave_store_count = stores; }
      }
    }
    if (!rows.length) throw new Error("報表沒有可匯入的訂單資料列。");
    if (rows.some(row => !row.record_date)) throw new Error("有資料列沒有可辨識日期；請檢查日期欄或檔名日期。");
    return {file, type, dates:[...new Set(rows.map(row => row.record_date))].sort(), rows};
  }
  function getPair() {
    if (prepared.length !== 2) return null;
    const byType = Object.fromEntries(prepared.map(file => [file.type, file]));
    if (!byType.ByDate || !byType.ByOrder) return null;
    const a = byType.ByDate.dates, b = byType.ByOrder.dates;
    if (a.length !== b.length || a.some((date, index) => date !== b[index])) return null;
    return {byType, dates:a};
  }
  function render(errors = []) {
    const rows = prepared.map(item => ({file:item.file.name, type:item.type, period:item.dates.length === 1 ? item.dates[0] : `${item.dates[0]}～${item.dates.at(-1)}（${item.dates.length}天）`, count:item.rows.length, status:"待匯入"}));
    for (const error of errors) rows.push({file:error.file, type:"—", period:"—", count:"—", status:error.message});
    preview.innerHTML = rows.length ? `<div class="staffing-preview-scroll"><table class="shift-data-table"><thead><tr><th>檔案</th><th>類型</th><th>日期</th><th>筆數</th><th>狀態</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${escapeHtml(row.file)}</td><td>${escapeHtml(row.type)}</td><td>${escapeHtml(row.period)}</td><td>${escapeHtml(row.count)}</td><td>${escapeHtml(row.status)}</td></tr>`).join("")}</tbody></table></div>` : "";
    button.disabled = !getPair();
  }
  input.addEventListener("change", async () => {
    prepared = []; button.disabled = true; message.textContent = "讀取檔案中…";
    const errors = [];
    for (const file of [...(input.files || [])]) { try { prepared.push(await parseFile(file)); } catch (error) { errors.push({file:file.name, message:error.message || "檔案無法讀取"}); } }
    if (fileLabel) fileLabel.textContent = [...(input.files || [])].map(file=>file.name).join("、") || "選擇 ByDate 與 ByOrder Excel";
    render(errors);
    const pair = getPair();
    message.textContent = errors.length ? `辨識完成；${errors.length} 個檔案格式不符或無法讀取。` : pair ? `兩份檔案日期一致，共 ${pair.dates.length} 天。按匯入後會先封存原始 Excel 至 Supabase。` : "請選擇一份 ByDate 與一份 ByOrder 檔案，且日期範圍需一致。";
  });
  async function archiveFiles(pair, ids = []) {
    const {data:{user}, error:userError} = await db.auth.getUser();
    if (userError || !user) throw new Error("請先登入管理後台。");
    for (const item of Object.values(pair.byType)) {
      const id = window.crypto?.randomUUID?.() || `archive-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const safeName = String(item.file.name || "source.xlsx").normalize("NFKC").replace(/[^A-Za-z0-9._-]+/g,"_").slice(-120) || "source.xlsx";
      const path = `998/${item.type}/${pair.dates[0]}/${id}-${safeName}`;
      const mime = /\.xlsm$/i.test(item.file.name) ? "application/vnd.ms-excel.sheet.macroEnabled.12" : /\.xls$/i.test(item.file.name) ? "application/vnd.ms-excel" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      const bytes = await item.file.arrayBuffer();
      const sha256 = window.crypto?.subtle ? [...new Uint8Array(await window.crypto.subtle.digest("SHA-256", bytes))].map(byte=>byte.toString(16).padStart(2,"0")).join("") : null;
      const upload = await db.storage.from(bucket).upload(path, item.file, {contentType:mime, upsert:false});
      if (upload.error) throw new Error(`原始 ${item.type} Excel 上傳 Supabase 失敗：${upload.error.message}`);
      const saved = await db.from("t998_score_source_archives").insert({id, report_type:item.type, source_file:item.file.name, storage_path:path, file_size_bytes:item.file.size, sha256, period_start:pair.dates[0], period_end:pair.dates.at(-1), row_count:item.rows.length, uploaded_by:user.id, import_status:"archived"});
      if (saved.error) { await db.storage.from(bucket).remove([path]); throw new Error(`檔案已上傳，但封存索引建立失敗：${saved.error.message}`); }
      ids.push(id);
    }
    return ids;
  }
  button.addEventListener("click", async () => {
    const pair = getPair();
    if (!pair) { message.textContent = "請選擇日期範圍一致的 ByDate 與 ByOrder Excel。"; return; }
    if (!window.confirm(`即將封存兩份原始 Excel 至 Supabase，並匯入 ${pair.dates.length} 天成績資料。確定繼續？`)) return;
    button.disabled = true; input.disabled = true; message.textContent = "先封存兩份原始 Excel 至 Supabase…";
    let archiveIds = [], importedCalls = 0;
    try {
      await archiveFiles(pair, archiveIds);
      for (let i = 0; i < pair.dates.length; i += 4) {
        const dates = pair.dates.slice(i, i + 4);
        const results = await Promise.all(dates.flatMap(date => Object.values(pair.byType).map(item => db.rpc("t998_import_score_batch", {p_report_date:date, p_report_type:item.type, p_source_file:item.file.name, p_rows:item.rows.filter(row => row.record_date === date)}))));
        importedCalls += results.filter(result => !result.error).length;
        const failed = results.find(result => result.error);
        if (failed) throw new Error(`成績匯入中止；${failed.error.message}`);
        message.textContent = `匯入成績中… ${Math.min(i + dates.length, pair.dates.length)}／${pair.dates.length} 天`;
      }
      const marked = await db.from("t998_score_source_archives").update({import_status:"imported", imported_at:new Date().toISOString()}).in("id", archiveIds);
      if (marked.error) throw new Error(`成績已匯入，但封存狀態更新失敗：${marked.error.message}`);
      message.textContent = `完成：${pair.dates.length} 天成績已匯入，兩份原始 Excel 已保存在 Supabase 私有空間。`;
      prepared = []; input.value = ""; if (fileLabel) fileLabel.textContent = "選擇 ByDate 與 ByOrder Excel"; render();
    } catch (error) {
      const detail = error.message || "請檢查登入及 Supabase 權限。";
      if (archiveIds.length) {
        await db.from("t998_score_source_archives").update({import_status:importedCalls ? "partial" : "archived", import_note:detail}).in("id", archiveIds);
        message.textContent = `原始檔已封存；成績匯入未完成：${detail}`;
      } else message.textContent = `匯入中止：${detail}`;
    } finally { input.disabled = false; button.disabled = !getPair(); }
  });
  window.T998ScoreSourceImport = {parseFile, getPair, archiveFiles, bucket};
})();

