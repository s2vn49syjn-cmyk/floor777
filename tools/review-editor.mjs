import {ReviewSession, findIsland, islandBounds, copy} from './builder-model.mjs';
import {fromLegacyHall} from './layout-adapter.mjs';
import {loadDraft, saveDraft, deleteDraft} from './review-store.mjs';

const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const state = {session: null, floorId: null, islandId: null, selectedMachines: new Set(),
  view: {x: 0, y: 0, w: 1000, h: 700}, saveTimer: null, saveQueue: Promise.resolve(), revision: 0, openToken: 0};
const sv = (tag, attrs = {}) => {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  return element;
};
const validId = id => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
const message = text => { $('message').textContent = text; };
const saveState = (stateName, label) => { $('saveState').dataset.state = stateName; $('saveState').textContent = label; };
const currentFloor = () => state.session?.layout.floors.find(floor => floor.id === state.floorId);
const currentIsland = () => state.islandId ? currentFloor()?.islands.find(island => island.id === state.islandId) : null;
const selectedOne = () => state.selectedMachines.size === 1 ? [...state.selectedMachines][0] : null;

async function fetchJSON(url) {
  const response = await fetch(url, {cache: 'no-store'});
  if (!response.ok) throw Error(`HTTP ${response.status}: ${url}`);
  return response.json();
}
async function readSource(id) {
  let layout = null, hall = null;
  try { layout = await fetchJSON(`/data/layouts/${id}.json`); } catch {}
  try { hall = await fetchJSON(`/data/${id}.json`); } catch {}
  if (!layout) {
    if (!hall) throw Error('layoutも旧店舗データも見つかりません');
    const name = id === 'hyper-arrow-mihara' ? 'mihara' : id;
    const positions = await fetchJSON(`/data/positions-${name}.json`);
    layout = fromLegacyHall(hall, positions);
  }
  if (layout.schemaVersion !== 3 || layout.storeId !== id) throw Error('storeIdまたはschemaVersionが一致しません');
  return {layout, referenceNumbers: hall?.seats?.map(seat => seat.seat) ?? null};
}

async function openLayout(id) {
  if (!validId(id)) throw Error('店舗IDは半角英数字とハイフンで入力してください');
  const token = ++state.openToken;
  if (state.saveTimer) await saveNow();
  else await state.saveQueue.catch(() => {});
  message('');
  saveState('saving', '読み込み中');
  let record;
  try { record = await loadDraft(id); }
  catch (error) { saveState('failed', '保存領域を開けません'); message(error.message); }
  const source = record ? {layout: record.working, referenceNumbers: record.referenceNumbers} : await readSource(id);
  if (token !== state.openToken) return;
  state.session = new ReviewSession(source.layout, {referenceNumbers: source.referenceNumbers});
  if (record?.original) state.session.original = copy(record.original);
  state.floorId = state.session.layout.floors[0]?.id ?? null;
  state.islandId = null;
  state.selectedMachines.clear();
  const floor = currentFloor();
  if (!floor) throw Error('フロアがありません');
  state.view = {x: 0, y: 0, w: floor.width, h: floor.height};
  $('storeId').value = id;
  const url = new URL(location.href); url.searchParams.set('store', id); history.replaceState(null, '', url);
  render();
  saveState('saved', record ? '下書き復元済み' : '元データを読み込み済み');
}

function scheduleSave() {
  state.revision++;
  saveState('saving', '保存中…');
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {void saveNow();}, 450);
}
async function saveNow() {
  if (!state.session) return;
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  const revision = state.revision;
  const record = {id: state.session.layout.storeId, original: copy(state.session.original),
    working: copy(state.session.layout), referenceNumbers: copy(state.session.referenceNumbers),
    savedAt: new Date().toISOString()};
  state.saveQueue = state.saveQueue.catch(() => {}).then(() => saveDraft(record));
  try {
    await state.saveQueue;
    if (revision === state.revision) saveState('saved', '保存済み');
  } catch (error) { saveState('failed', '保存失敗'); message(`下書きを保存できません: ${error.message}`); }
}

function mutate(action) {
  if (!state.session) return;
  try {
    const changed = action();
    if (changed !== false) {render(); scheduleSave(); message('');}
  } catch (error) {message(error.message); render();}
}

function setView(view) {
  const floor = currentFloor();
  if (!floor) return;
  const w = Math.max(30, Math.min(floor.width * 2, view.w));
  const h = Math.max(30, Math.min(floor.height * 2, view.h));
  state.view = {x: Math.max(-floor.width / 2, Math.min(floor.width * 1.5 - w, view.x)),
    y: Math.max(-floor.height / 2, Math.min(floor.height * 1.5 - h, view.y)), w, h};
  $('reviewMap').setAttribute('viewBox', `${state.view.x} ${state.view.y} ${w} ${h}`);
}
function fitMap() {const floor = currentFloor(); if (floor) setView({x: 0, y: 0, w: floor.width, h: floor.height});}
function zoom(factor) {
  const {x, y, w, h} = state.view, nw = w / factor, nh = h / factor;
  setView({x: x + (w - nw) / 2, y: y + (h - nh) / 2, w: nw, h: nh});
}
function focusRect(position) {
  const [x, y, w, h] = position, floor = currentFloor();
  if (!floor) return;
  const width = Math.max(180, Math.min(floor.width, w * 8));
  const height = Math.max(140, Math.min(floor.height, h * 8));
  setView({x: x + w / 2 - width / 2, y: y + h / 2 - height / 2, w: width, h: height});
}
function floorChanged(id) {
  state.floorId = id;
  state.islandId = null;
  state.selectedMachines.clear();
  const floor = currentFloor();
  if (floor) state.view = {x: 0, y: 0, w: floor.width, h: floor.height};
  render();
}
function chooseIsland(id) {state.islandId = id; state.selectedMachines.clear(); render();}
function chooseMachine(id, islandId, multiple = false) {
  state.islandId = islandId;
  if (!multiple) state.selectedMachines.clear();
  if (multiple && state.selectedMachines.has(id)) state.selectedMachines.delete(id);
  else state.selectedMachines.add(id);
  render();
}

function draw() {
  const svg = $('reviewMap');
  svg.replaceChildren();
  const floor = currentFloor();
  if (!floor) return;
  svg.append(sv('rect', {x: 0, y: 0, width: floor.width, height: floor.height, class: 'map-background'}));
  const report = state.session.diagnostics;
  const problemIslands = new Set(report.diagnostics.filter(item => item.islandId).map(item => item.islandId));
  const problemMachines = new Set(report.diagnostics.filter(item => item.machineId).map(item => item.machineId));
  const drawMachine = (parent, machine, islandId = null) => {
    const [x, y, width, height] = machine.position;
    const group = sv('g', {'data-machine-id': machine.id, class: `review-machine${islandId ? '' : ' review-unassigned'}${state.selectedMachines.has(machine.id) ? ' selected' : ''}${problemMachines.has(machine.id) ? ' problem' : ''}`});
    if (islandId) group.dataset.islandId = islandId;
    group.append(sv('rect', {x, y, width, height, rx: Math.min(3, width / 7)}));
    const label = sv('text', {x: x + width / 2, y: y + height / 2});
    label.textContent = machine.number ?? '·';
    group.append(label);
    parent.append(group);
  };
  for (const island of floor.islands) {
    const group = sv('g', {'data-island-id': island.id,
      class: `review-island${state.islandId === island.id ? ' selected' : ''}${problemIslands.has(island.id) ? ' problem' : ''}`});
    const bounds = islandBounds(island), pad = Math.max(5, Math.min(14, bounds.width / 20));
    group.append(sv('rect', {x: bounds.x - pad, y: bounds.y - pad,
      width: bounds.width + pad * 2, height: bounds.height + pad * 2, rx: 6, class: 'review-island-outline'}));
    const label = sv('text', {x: bounds.x, y: bounds.y - pad - 4, class: 'review-island-label'});
    label.textContent = island.label || island.id;
    group.append(label);
    island.machines.forEach(machine => drawMachine(group, machine, island.id));
    svg.append(group);
  }
  floor.unassignedMachines.forEach(machine => drawMachine(svg, machine));
  setView(state.view);
}

function renderInspector() {
  const floor = currentFloor(), island = currentIsland(), ready = Boolean(state.session);
  $('floorSelect').replaceChildren(...(state.session?.layout.floors || []).map(item => new Option(item.label || item.id, item.id)));
  $('floorSelect').value = state.floorId || '';
  $('islandSelect').replaceChildren(new Option('島を選択', ''), ...(floor?.islands || []).map(item =>
    new Option(`${item.label || item.id}（${item.machineCount}台）`, item.id)));
  $('islandSelect').value = island?.id || '';
  for (const id of ['floorSelect', 'islandSelect', 'zoomOut', 'zoomIn', 'fitMap', 'addIsland', 'downloadDraft', 'saveNow', 'resetDraft']) $(id).disabled = !ready;
  for (const id of ['applyPosition', 'applyRotation', 'rotateMinus', 'rotatePlus', 'applyScale', 'applyCount',
    'deleteIsland', 'assignNumbers', 'reverseNumbers', 'clearNumbers']) $(id).disabled = !island;
  $('undo').disabled = !state.session?.canUndo;
  $('redo').disabled = !state.session?.canRedo;
  if (island) {
    $('islandX').value = island.geometry?.x ?? 0;
    $('islandY').value = island.geometry?.y ?? 0;
    $('rotation').value = island.geometry?.rotation ?? 0;
    $('machineCount').value = island.machineCount;
  }
  const machines = island?.machines || [];
  $('machineList').replaceChildren(...machines.map((machine, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${index + 1}: ${machine.number ?? '欠番'}`;
    button.classList.toggle('selected', state.selectedMachines.has(machine.id));
    button.onclick = event => chooseMachine(machine.id, island.id, event.ctrlKey || event.metaKey || event.shiftKey);
    return button;
  }));
  $('selectionCount').textContent = state.selectedMachines.size ? `${state.selectedMachines.size}台を選択中` : '島全体を対象';
  const machineId = selectedOne();
  const machine = machineId ? [...(floor?.unassignedMachines || []), ...machines].find(item => item.id === machineId) : null;
  $('applySingle').disabled = !machine;
  $('singleNumber').value = machine?.number ?? '';
  $('storeLabel').textContent = ready ? `${state.session.layout.storeName || state.session.layout.storeId} / ${state.session.layout.storeId}` : '店舗を選択してください';
  $('verificationBadge').textContent = ready ? `状態: ${state.session.layout.verification.status}` : '';
  $('sourceBadge').textContent = ready ? `${state.session.layout.review?.humanModified ? '人間修正済み' : '原案のまま'} / ${state.session.layout.provenance?.sourceType || '出典未登録'}` : '';
  const layout = state.session?.layout, confidence = layout?.confidence, provenance = layout?.provenance;
  const percent = value => typeof value === 'number' ? `${Math.round(value * 100)}%` : '未判定';
  $('confidenceSummary').textContent = layout ? `信頼度: 全体 ${percent(confidence?.overall)} / 配置 ${percent(confidence?.position)} / 台番号 ${percent(confidence?.number)}` : '';
  $('provenanceSummary').textContent = layout ? `出典: ${provenance?.sourceType || '未登録'} / 観測日 ${provenance?.observedAt || '不明'} / hash ${provenance?.sourceHash?.slice(0, 12) || 'なし'}` : '';
  const notes = layout?.verification?.notes ?? [];
  $('uncertaintySummary').replaceChildren(...notes.slice(0, 20).map(note => {
    const item = document.createElement('p'); item.textContent = `要確認: ${note}`; return item;
  }));
  if (notes.length > 20) $('uncertaintySummary').append(`${notes.length - 20}件の追加メモがあります`);
}

function renderDiagnostics() {
  const list = $('diagnostics');
  list.replaceChildren();
  if (!state.session) return;
  const report = state.session.diagnostics;
  $('diagnosticCount').textContent = `${report.diagnostics.length}件`;
  if (!report.diagnostics.length) list.textContent = '検査項目に問題はありません。島の実位置などは人間が資料と照合してください。';
  for (const diagnostic of report.diagnostics) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = diagnostic.severity;
    button.textContent = `${diagnostic.severity === 'error' ? 'エラー' : '注意'}: ${diagnostic.message}`;
    button.title = [diagnostic.floorId, diagnostic.islandId, diagnostic.machineId].filter(Boolean).join(' / ');
    button.onclick = () => {
      if (diagnostic.floorId && state.floorId !== diagnostic.floorId) floorChanged(diagnostic.floorId);
      state.islandId = diagnostic.islandId;
      state.selectedMachines.clear();
      if (diagnostic.machineId) state.selectedMachines.add(diagnostic.machineId);
      render();
      const machine = [...currentFloor().unassignedMachines, ...currentFloor().islands.flatMap(item => item.machines)]
        .find(item => item.id === diagnostic.machineId);
      if (machine) focusRect(machine.position);
      else if (state.islandId) {
        const bounds = islandBounds(currentIsland());
        focusRect([bounds.x, bounds.y, bounds.width, bounds.height]);
      }
      $('reviewMap').scrollIntoView({block: 'nearest', behavior: 'smooth'});
    };
    list.append(button);
  }
  $('markVerified').disabled = !report.valid || report.diagnostics.length > 0;
}
function render() {renderInspector(); draw(); renderDiagnostics();}

function parseExcluded(text) {
  const result = [];
  for (const part of text.normalize('NFKC').split(/[\s,、]+/).filter(Boolean)) {
    const match = part.match(/^(\d+)(?:[-〜~](\d+))?$/);
    if (!match) throw Error('除外番号は 804,808-810 の形式で入力してください');
    const from = Number(match[1]), to = Number(match[2] || match[1]);
    if (Math.abs(to - from) > 3000) throw Error('除外番号が多すぎます');
    for (let number = from; ; number += from <= to ? 1 : -1) {result.push(number); if (number === to) break;}
  }
  return result;
}
function numberingOptions() {
  return {direction: $('numberDirection').value, side: $('islandSide').value,
    ids: state.selectedMachines.size ? [...state.selectedMachines] : null};
}
function screenPoint(event) {
  const point = $('reviewMap').createSVGPoint();
  point.x = event.clientX; point.y = event.clientY;
  const mapped = point.matrixTransform($('reviewMap').getScreenCTM().inverse());
  return {x: mapped.x, y: mapped.y};
}

function attachEvents() {
  $('openStore').onclick = () => {void openLayout($('storeId').value.trim()).catch(error => {saveState('failed', '読み込み失敗'); message(error.message);});};
  $('storeId').onkeydown = event => {if (event.key === 'Enter') $('openStore').click();};
  $('importFile').onchange = async event => {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      state.openToken++;
      if (state.saveTimer) await saveNow();
      const layout = JSON.parse(await file.text());
      if (layout.schemaVersion !== 3 || !validId(layout.storeId)) throw Error('schemaVersion 3のlayout JSONを選んでください');
      const original = copy(layout);
      state.session = new ReviewSession(layout);
      state.session.original = original;
      state.floorId = layout.floors[0]?.id ?? null;
      if (!state.floorId) throw Error('フロアがありません');
      state.islandId = null; state.selectedMachines.clear();
      state.view = {x: 0, y: 0, w: currentFloor().width, h: currentFloor().height};
      $('storeId').value = layout.storeId;
      const url = new URL(location.href); url.searchParams.set('store', layout.storeId); history.replaceState(null, '', url);
      render(); scheduleSave(); message('JSONを作業用下書きとして読み込みました。公開データは変更していません。');
    } catch (error) {message(error.message);}
    event.target.value = '';
  };
  $('floorSelect').onchange = event => floorChanged(event.target.value);
  $('islandSelect').onchange = event => chooseIsland(event.target.value || null);
  $('zoomIn').onclick = () => zoom(1.3);
  $('zoomOut').onclick = () => zoom(1 / 1.3);
  $('fitMap').onclick = fitMap;
  $('undo').onclick = () => mutate(() => state.session.undo());
  $('redo').onclick = () => mutate(() => state.session.redo());
  $('applyPosition').onclick = () => mutate(() => state.session.moveIsland(state.islandId,
    Number($('islandX').value) - currentIsland().geometry.x, Number($('islandY').value) - currentIsland().geometry.y));
  $('applyRotation').onclick = () => mutate(() => state.session.rotateIsland(state.islandId,
    Number($('rotation').value) - (currentIsland().geometry.rotation ?? 0)));
  $('rotateMinus').onclick = () => mutate(() => state.session.rotateIsland(state.islandId, -1));
  $('rotatePlus').onclick = () => mutate(() => state.session.rotateIsland(state.islandId, 1));
  $('applyScale').onclick = () => mutate(() => state.session.scaleIsland(state.islandId, Number($('scaleFactor').value)));
  $('applyCount').onclick = () => mutate(() => state.session.setMachineCount(state.islandId, Number($('machineCount').value)));
  $('addIsland').onclick = () => mutate(() => {
    const id = state.session.addIsland(state.floorId, {shape: $('newShape').value,
      x: state.view.x + Math.max(80, state.view.w / 3), y: state.view.y + Math.max(80, state.view.h / 3), count: 8});
    state.islandId = id; state.selectedMachines.clear();
  });
  $('deleteIsland').onclick = () => {
    if (!confirm('選択中の島を削除しますか？「戻す」で復元できます。')) return;
    mutate(() => {state.session.deleteIsland(state.islandId); state.islandId = null; state.selectedMachines.clear();});
  };
  $('assignNumbers').onclick = () => mutate(() => state.session.assignSequential(state.islandId, {
    ...numberingOptions(), start: Number($('startNumber').value),
    count: $('assignCount').value ? Number($('assignCount').value) : null,
    end: $('endNumber').value ? Number($('endNumber').value) : null,
    exclude: parseExcluded($('excludeNumbers').value)
  }));
  $('reverseNumbers').onclick = () => mutate(() => state.session.reverseNumbers(state.islandId, numberingOptions()));
  $('clearNumbers').onclick = () => mutate(() => state.session.clearNumbers(state.islandId,
    state.selectedMachines.size ? [...state.selectedMachines] : null));
  $('applySingle').onclick = () => mutate(() => state.session.setMachineNumber(selectedOne(),
    $('singleNumber').value ? Number($('singleNumber').value) : null));
  $('markVerified').onclick = () => {
    if (!confirm('現行資料と台数・台番号・実位置・島配置を照合しましたか？確認済みは作業用下書きにだけ保存します。')) return;
    mutate(() => state.session.verify());
  };
  $('saveNow').onclick = () => {void saveNow();};
  $('downloadDraft').onclick = () => {
    const layout = state.session?.layout; if (!layout) return;
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(layout, null, 2)}\n`], {type: 'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = `${layout.storeId}-review-draft.json`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $('resetDraft').onclick = () => {
    if (!confirm('この端末の作業用下書きを消し、読み込み時の原案に戻しますか？')) return;
    const id = state.session.layout.storeId, original = copy(state.session.original), refs = state.session.referenceNumbers;
    void deleteDraft(id).then(() => {
      state.session = new ReviewSession(original, {referenceNumbers: refs});
      state.floorId = original.floors[0].id; state.islandId = null; state.selectedMachines.clear();
      state.view = {x: 0, y: 0, w: currentFloor().width, h: currentFloor().height};
      render(); saveState('saved', '原案に戻しました');
    }).catch(error => {saveState('failed', '保存失敗'); message(error.message);});
  };
  document.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return;
    if (event.key.toLowerCase() === 'z') {event.preventDefault(); (event.shiftKey ? $('redo') : $('undo')).click();}
    if (event.key.toLowerCase() === 'y') {event.preventDefault(); $('redo').click();}
  });

  let drag = null, suppressClick = false;
  const map = $('reviewMap');
  map.addEventListener('pointerdown', event => {
    if (!state.session) return;
    const point = screenPoint(event), islandId = event.target.closest('[data-island-id]')?.dataset.islandId || null;
    drag = {pointerId: event.pointerId, start: point, islandId, original: {...state.view}, moved: false};
    map.setPointerCapture(event.pointerId);
  });
  map.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = screenPoint(event), dx = point.x - drag.start.x, dy = point.y - drag.start.y;
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    if (drag.islandId) {
      const group = [...map.querySelectorAll('.review-island')].find(node => node.dataset.islandId === drag.islandId);
      if (group) group.setAttribute('transform', `translate(${dx} ${dy})`);
    } else setView({...drag.original, x: drag.original.x - dx, y: drag.original.y - dy});
  });
  map.addEventListener('pointerup', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = screenPoint(event), moved = drag.moved, islandId = drag.islandId;
    if (moved && islandId) mutate(() => state.session.moveIsland(islandId, point.x - drag.start.x, point.y - drag.start.y));
    if (moved) {suppressClick = true; setTimeout(() => {suppressClick = false;}, 0);}
    drag = null;
  });
  map.addEventListener('pointercancel', () => {drag = null; render();});
  map.addEventListener('click', event => {
    if (suppressClick) return;
    const machine = event.target.closest('[data-machine-id]');
    if (machine) chooseMachine(machine.dataset.machineId, machine.dataset.islandId || null,
      event.ctrlKey || event.metaKey || event.shiftKey);
    else {const island = event.target.closest('[data-island-id]'); if (island) chooseIsland(island.dataset.islandId);}
  });
  map.addEventListener('wheel', event => {if (!state.session) return; event.preventDefault(); zoom(event.deltaY < 0 ? 1.15 : 1 / 1.15);}, {passive: false});
}

async function init() {
  if (!['localhost', '127.0.0.1'].includes(location.hostname)) {
    document.body.textContent = 'Review Editorはローカル開発環境専用です。公開サイトからは使用できません。';
    return;
  }
  attachEvents();
  try {
    const ids = await fetchJSON('/tools/review-catalog.json');
    $('storeIds').replaceChildren(...ids.map(id => new Option(id, id)));
  } catch (error) {message(`店舗候補一覧を読み込めません: ${error.message}`);}
  saveState('saved', '未編集');
  const id = new URL(location.href).searchParams.get('store');
  if (id) await openLayout(id);
}
init().catch(error => {saveState('failed', '読み込み失敗'); message(error.message);});
