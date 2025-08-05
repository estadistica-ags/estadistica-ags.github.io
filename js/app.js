import { auth, db } from './firebase.js';
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';
import {
  collection,
  addDoc,
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
  doc,
  updateDoc,
  deleteDoc
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';

// Helpers
const toast = msg => {
  Toastify({ text: msg, duration: 3000, gravity: 'top', position: 'right', backgroundColor: '#2563eb' }).showToast();
};

// Generic error handler
const handleError = (err, msg) => {
  console.error(err);
  if (msg) toast(msg);
};

const formatDate = iso => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const formatDateLong = iso => {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
};

// Quincena helpers
const MONTO_QUINCENA = 30;

const computeEstatus = (fechaLimite, abonado, esperado) => {
  const hoy = new Date().toISOString().slice(0, 10);
  if (abonado >= esperado) return 'Pagado';
  if (fechaLimite < hoy) return abonado > 0 ? 'Incompleto' : 'Pendiente';
  return 'Futuro';
};

const STATUS_STYLES = {
  Pagado: { icon: '✅', border: 'border-green-500', badge: 'bg-green-500' },
  Pendiente: { icon: '⏳', border: 'border-red-500', badge: 'bg-red-500' },
  Incompleto: { icon: '🔶', border: 'border-yellow-500', badge: 'bg-yellow-500' },
  Futuro: { icon: '📅', border: 'border-gray-400', badge: 'bg-gray-400' }
};

const buildCalendar = (ingreso, fin) => {
  const res = [];
  const start = new Date(ingreso);
  let current = new Date(start.getFullYear(), start.getMonth(), 16);
  if (start.getDate() > 16) current = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  const end = new Date(fin);
  while (current <= end) {
    const year = current.getFullYear();
    const month = current.getMonth();
    const qNumber = month * 2 + (current.getDate() === 16 ? 1 : 2);
    const qId = `${year}-Q${String(qNumber).padStart(2, '0')}`;
    res.push({
      quincena: qId,
      fechaLimite: current.toISOString().slice(0, 10)
    });
    if (current.getDate() === 16) {
      current = new Date(year, month + 1, 0);
    } else {
      current = new Date(year, month + 1, 16);
    }
  }
  return res;
};

const ensureQuincenas = async (id, ingreso) => {
  const fin = new Date();
  fin.setMonth(fin.getMonth() + 1);
  const calendar = buildCalendar(ingreso, fin);
  const existingSnap = await getDocs(query(collection(db, 'pagos'), where('id_integrante', '==', id)));
  const existentes = new Set();
  existingSnap.forEach(d => existentes.add(d.data().quincena));
  for (const q of calendar) {
    if (!existentes.has(q.quincena)) {
      await addDoc(collection(db, 'pagos'), {
        id_integrante: id,
        quincena: q.quincena,
        fechaLimite: q.fechaLimite,
        montoEsperado: MONTO_QUINCENA,
        montoAbonado: 0,
        estatus: computeEstatus(q.fechaLimite, 0, MONTO_QUINCENA)
      });
    }
  }
};

const registrarAbono = async (id, monto) => {
  try {
    const intDoc = await getDoc(doc(db, 'integrantes', id));
    const ingreso = intDoc.data()?.ingreso || new Date().toISOString().slice(0, 10);
    await ensureQuincenas(id, ingreso);
    let restante = monto;
    const snap = await getDocs(
      query(collection(db, 'pagos'), where('id_integrante', '==', id), orderBy('fechaLimite'))
    );
    for (const d of snap.docs) {
      if (restante <= 0) break;
      const data = d.data();
      const falta = data.montoEsperado - (data.montoAbonado || 0);
      if (falta <= 0) continue;
      const aplicar = Math.min(falta, restante);
      restante -= aplicar;
      const abonado = (data.montoAbonado || 0) + aplicar;
      const estatus = computeEstatus(data.fechaLimite, abonado, data.montoEsperado);
      await updateDoc(d.ref, { montoAbonado: abonado, estatus });
    }
  } catch (err) {
    handleError(err, 'No se pudo registrar el abono');
  }
};

const abonarQuincena = async (pagoId, monto) => {
  try {
    const ref = doc(db, 'pagos', pagoId);
    const snap = await getDoc(ref);
    const data = snap.data();
    const abonado = (data.montoAbonado || 0) + monto;
    const estatus = computeEstatus(data.fechaLimite, abonado, data.montoEsperado);
    await updateDoc(ref, { montoAbonado: abonado, estatus });
  } catch (err) {
    handleError(err, 'No se pudo registrar el abono');
    throw err;
  }
};

const ensureAllQuincenas = async () => {
  const snap = await getDocs(collection(db, 'integrantes'));
  for (const d of snap.docs) {
    const data = d.data();
    await ensureQuincenas(d.id, data.ingreso || new Date().toISOString().slice(0, 10));
  }
};

// Views
const loginView = document.getElementById('login-view');
const appView = document.getElementById('app');
const views = document.querySelectorAll('.view');

const loginForm = document.getElementById('login-form');
const logoutBtn = document.getElementById('logout');
const logoutBtnMobile = document.getElementById('logout-mobile');
const loginError = document.getElementById('login-error');
const menuToggle = document.getElementById('menu-toggle');
const mobileMenu = document.getElementById('mobile-menu');
const menuClose = document.getElementById('menu-close');

let currentUser = null;
let currentRole = 'consulta';

let pagosData = [];
let pagosMostrados = 0;
let pagoSeleccionado = null;
let integrantesMap = {};

const cardsPagos = document.getElementById('cards-pagos');
const verMasBtn = document.getElementById('ver-mas');
const barraAbonoGlobal = document.getElementById('barra-abono-global');
const btnAbonoGlobal = document.getElementById('btn-abono-global');
const modalDetalle = document.getElementById('modal-detalle');
const modalAbono = document.getElementById('modal-abono');
const modalAbonoGlobal = document.getElementById('modal-abono-global');

// Modal elements for gestión de integrantes
const modalUsuario = document.getElementById('modal-usuario');
const modalTitle = document.getElementById('modal-title');
const modalClose = document.getElementById('modal-close');
const formUsuario = document.getElementById('form-usuario');
const btnAddUsuario = document.getElementById('btn-add-usuario');
let editingId = null;

// Routing
function navigate() {
  const hash = location.hash || '#/dashboard';
  views.forEach(v => v.classList.add('hidden'));
  const view = document.getElementById('view-' + hash.replace('#/', ''));
  if (view) view.classList.remove('hidden');
}
window.addEventListener('hashchange', navigate);

// Auth
loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
    loginForm.reset();
  } catch (err) {
    loginError.textContent = err.message;
    loginError.classList.remove('hidden');
  }
});

logoutBtn?.addEventListener('click', () => signOut(auth));
logoutBtnMobile?.addEventListener('click', () => signOut(auth));

menuToggle?.addEventListener('click', () => mobileMenu.classList.remove('hidden'));
menuClose?.addEventListener('click', () => mobileMenu.classList.add('hidden'));
mobileMenu?.addEventListener('click', e => {
  if (e.target === mobileMenu) mobileMenu.classList.add('hidden');
});

onAuthStateChanged(auth, async user => {
  if (user) {
    loginView.classList.add('hidden');
    appView.classList.remove('hidden');
    currentUser = user;
    await loadRole();
    initApp();
  } else {
    appView.classList.add('hidden');
    loginView.classList.remove('hidden');
    currentUser = null;
  }
});

async function loadRole() {
  try {
    const snap = await getDoc(doc(db, 'usuarios', currentUser.uid));
    if (snap.exists()) {
      const data = snap.data();
      currentRole = data.rol || 'consulta';
    }
  } catch (err) {
    handleError(err, 'No se pudo cargar el rol del usuario');
  }
}

// Initialization after login
async function initApp() {
  navigate();
  await ensureAllQuincenas();
  loadDashboard();
  loadUsuarios();
  loadPagos();
  loadEgresos();
  setupForms();
  loadEstado();
}

function setupForms() {
  if (currentRole === 'admin') {
    document.getElementById('form-egreso').classList.remove('hidden');
    document.getElementById('btn-add-usuario').classList.remove('hidden');
    document.getElementById('usuarios-acciones').classList.remove('hidden');
    document.getElementById('egresos-acciones').classList.remove('hidden');
  }
}

function openUsuarioModal(data = null) {
  modalUsuario.classList.remove('hidden');
  if (data) {
    editingId = data.id;
    modalTitle.textContent = 'Editar Integrante';
    document.getElementById('usuario-nombre').value = data.nombre || '';
    document.getElementById('usuario-email').value = data.email || '';
    document.getElementById('usuario-rol').value = data.rol || '';
    document.getElementById('usuario-activo').value = data.activo ? 'true' : 'false';
    document.getElementById('usuario-cumple').value = data.cumple || '';
    document.getElementById('usuario-ingreso').value = data.ingreso || '';
  } else {
    editingId = null;
    modalTitle.textContent = 'Agregar Integrante';
    formUsuario.reset();
  }
}

function closeUsuarioModal() {
  modalUsuario.classList.add('hidden');
  formUsuario.reset();
}

btnAddUsuario?.addEventListener('click', () => openUsuarioModal());
modalClose?.addEventListener('click', closeUsuarioModal);
modalUsuario?.addEventListener('click', e => {
  if (e.target === modalUsuario) closeUsuarioModal();
});

formUsuario?.addEventListener('submit', async e => {
  e.preventDefault();
  const nombre = document.getElementById('usuario-nombre').value.trim();
  const email = document.getElementById('usuario-email').value.trim();
  const rol = document.getElementById('usuario-rol').value;
  const activo = document.getElementById('usuario-activo').value;
  const cumple = document.getElementById('usuario-cumple').value;
  const ingreso = document.getElementById('usuario-ingreso').value;
  if (!nombre || !email || !rol || !activo || !cumple || !ingreso) return toast('Datos incompletos');
  const data = { nombre, email, rol, activo: activo === 'true', cumple, ingreso };
  try {
    if (editingId) {
      await updateDoc(doc(db, 'integrantes', editingId), data);
      toast('Integrante actualizado');
    } else {
      await addDoc(collection(db, 'integrantes'), data);
      toast('Integrante agregado');
    }
    closeUsuarioModal();
    loadUsuarios();
    loadCumples();
  } catch (err) {
    handleError(err, 'No se pudo guardar el integrante');
  }
});

// Usuarios
async function loadUsuarios() {
  try {
    const tbody = document.getElementById('tabla-usuarios');
    tbody.innerHTML = '';
    const snap = await getDocs(collection(db, 'integrantes'));
    snap.forEach(docu => {
      const d = docu.data();
      const tr = document.createElement('tr');
      tr.className = 'border-b odd:bg-white even:bg-gray-50';
      tr.innerHTML = `
        <td class="px-4 py-2">${d.nombre}</td>
        <td class="px-4 py-2">${d.email}</td>
        <td class="px-4 py-2">${d.rol}</td>
        <td class="px-4 py-2">${d.activo ? 'Sí' : 'No'}</td>
        <td class="px-4 py-2">${formatDate(d.cumple)}</td>
        ${currentRole === 'admin' ? `<td class="px-4 py-2 space-x-2">
            <button class="edit-usuario" data-id="${docu.id}" data-nombre="${d.nombre}" data-email="${d.email}" data-rol="${d.rol}" data-activo="${d.activo}" data-cumple="${d.cumple}" data-ingreso="${d.ingreso}">✏️</button>
            <button class="delete-usuario" data-id="${docu.id}">🗑️</button>
          </td>` : ''}
      `;
      tbody.appendChild(tr);
    });
    const selPago = document.getElementById('pago-integrante');
    const selEstado = document.getElementById('estado-integrante');
    if (selPago) selPago.innerHTML = '<option value="">Integrante</option>';
    if (selEstado) selEstado.innerHTML = '';
    snap.forEach(docu => {
      const d = docu.data();
      if (selPago) selPago.innerHTML += `<option value="${docu.id}">${d.nombre}</option>`;
      if (selEstado) selEstado.innerHTML += `<option value="${docu.id}">${d.nombre}</option>`;
    });
  } catch (err) {
    handleError(err, 'No se pudieron cargar los usuarios');
  }
}

document.getElementById('tabla-usuarios')?.addEventListener('click', async e => {
  const target = e.target;
  if (target.classList.contains('edit-usuario')) {
    openUsuarioModal({
      id: target.dataset.id,
      nombre: target.dataset.nombre,
      email: target.dataset.email,
      rol: target.dataset.rol,
      activo: target.dataset.activo === 'true',
      cumple: target.dataset.cumple,
      ingreso: target.dataset.ingreso
    });
  } else if (target.classList.contains('delete-usuario')) {
    if (confirm('¿Eliminar integrante?')) {
      try {
        await deleteDoc(doc(db, 'integrantes', target.dataset.id));
        toast('Integrante eliminado');
        loadUsuarios();
        loadCumples();
      } catch (err) {
        handleError(err, 'No se pudo eliminar el integrante');
      }
    }
  }
});

// Pagos
async function loadPagos() {
  try {
    cardsPagos.innerHTML = '';
    pagosData = [];
    pagosMostrados = 0;
    integrantesMap = {};
    const intSnap = await getDocs(collection(db, 'integrantes'));
    for (const d of intSnap.docs) {
      const data = d.data();
      integrantesMap[d.id] = data.nombre;
      await ensureQuincenas(d.id, data.ingreso || new Date().toISOString().slice(0, 10));
    }
    const selGlobal = document.getElementById('select-integrante');
    if (selGlobal) {
      selGlobal.innerHTML = '<option value="">Integrante</option>';
      Object.entries(integrantesMap).forEach(([id, nombre]) => {
        selGlobal.innerHTML += `<option value="${id}">${nombre}</option>`;
      });
    }
    const snap = await getDocs(collection(db, 'pagos'));
    snap.forEach(docu => {
      const p = docu.data();
      const estatus = computeEstatus(p.fechaLimite, p.montoAbonado || 0, p.montoEsperado);
      if (estatus !== p.estatus) updateDoc(docu.ref, { estatus });
      pagosData.push({ id: docu.id, ...p, estatus });
    });
    pagosData.sort((a, b) => new Date(a.fechaLimite) - new Date(b.fechaLimite));
    renderPagos();
    barraAbonoGlobal?.classList.remove('hidden');
    if (currentRole === 'consulta') {
      btnAbonoGlobal?.setAttribute('disabled', 'true');
      btnAbonoGlobal?.classList.add('opacity-50', 'cursor-not-allowed');
    } else {
      btnAbonoGlobal?.removeAttribute('disabled');
      btnAbonoGlobal?.classList.remove('opacity-50', 'cursor-not-allowed');
    }
  } catch (err) {
    handleError(err, 'No se pudieron cargar los pagos');
  }
}

function renderPagos() {
  const frag = document.createDocumentFragment();
  const slice = pagosData.slice(pagosMostrados, pagosMostrados + 10);
  slice.forEach(p => {
    const info = STATUS_STYLES[p.estatus] || STATUS_STYLES.Futuro;
    const card = document.createElement('div');
    card.className = `relative bg-white rounded-lg shadow p-4 border-l-4 ${info.border}`;
    card.innerHTML = `
      <span class="absolute top-2 right-2 text-xs text-white px-2 py-1 rounded ${info.badge}">${p.estatus}</span>
      <div class="flex items-center mb-2"><span class="text-2xl mr-2">${info.icon}</span><h3 class="font-bold">${p.quincena}</h3></div>
      <p class="text-sm text-gray-600 mb-1">Fecha límite: ${formatDateLong(p.fechaLimite)}</p>
      <p class="text-sm text-gray-600 mb-1">Monto esperado: $${p.montoEsperado.toFixed(2)}</p>
      <p class="text-sm text-gray-600 mb-2">Monto abonado: $${(p.montoAbonado || 0).toFixed(2)}</p>
      <div class="flex space-x-2">
        <button data-id="${p.id}" class="ver-detalle bg-blue-500 text-white px-2 py-1 rounded text-sm">👁 Ver detalle</button>
        <button data-id="${p.id}" class="abonar bg-green-500 text-white px-2 py-1 rounded text-sm ${currentRole === 'consulta' ? 'opacity-50 cursor-not-allowed' : ''}" ${currentRole === 'consulta' ? 'disabled' : ''}>➕ Abonar</button>
      </div>
    `;
    frag.appendChild(card);
  });
  cardsPagos.appendChild(frag);
  pagosMostrados += slice.length;
  if (pagosMostrados < pagosData.length) {
    verMasBtn.classList.remove('hidden');
  } else {
    verMasBtn.classList.add('hidden');
  }
}

async function loadEgresos() {
  try {
    const tbody = document.getElementById('tabla-egresos');
    tbody.innerHTML = '';
    const snap = await getDocs(collection(db, 'egresos'));
    snap.forEach(doc => {
      const e = doc.data();
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="border px-2 py-1">${e.fecha}</td>
                      <td class="border px-2 py-1">${e.concepto}</td>
                      <td class="border px-2 py-1">$${e.monto.toFixed(2)}</td>
                      <td class="border px-2 py-1">${e.detalle}</td>` +
                      (currentRole === 'admin' ? `<td class="border px-2 py-1"><button class="edit-egreso text-blue-600" data-id="${doc.id}" data-fecha="${e.fecha}" data-concepto="${e.concepto}" data-monto="${e.monto}" data-detalle="${e.detalle}">Editar</button></td>` : '');
      tbody.appendChild(tr);
    });
  } catch (err) {
    handleError(err, 'No se pudieron cargar los egresos');
  }
}

document.getElementById('tabla-egresos')?.addEventListener('click', async e => {
  if (e.target.classList.contains('edit-egreso')) {
    const { id, fecha, concepto, monto, detalle } = e.target.dataset;
    const nuevaFecha = prompt('Fecha', fecha);
    if (nuevaFecha === null) return;
    const nuevoConcepto = prompt('Concepto', concepto) || concepto;
    const nuevoMontoStr = prompt('Monto', monto);
    if (nuevoMontoStr === null) return;
    const nuevoMonto = parseFloat(nuevoMontoStr);
    const nuevoDetalle = prompt('Detalle', detalle) || detalle;
    try {
      await updateDoc(doc(db, 'egresos', id), { fecha: nuevaFecha, concepto: nuevoConcepto, monto: nuevoMonto, detalle: nuevoDetalle });
      toast('Egreso actualizado');
      loadEgresos();
      loadDashboard();
    } catch (err) {
      handleError(err, 'No se pudo actualizar el egreso');
    }
  }
});

// Dashboard
async function loadDashboard() {
  try {
    const pagosSnap = await getDocs(collection(db, 'pagos'));
    const egresosSnap = await getDocs(collection(db, 'egresos'));
    let totalPagos = 0;
    let totalEgresos = 0;
    pagosSnap.forEach(d => (totalPagos += d.data().montoAbonado || 0));
    egresosSnap.forEach(d => (totalEgresos += d.data().monto));
    document.getElementById('total-ingresos').textContent = `$${totalPagos.toFixed(2)}`;
    document.getElementById('total-egresos').textContent = `$${totalEgresos.toFixed(2)}`;
    document.getElementById('saldo').textContent = `$${(totalPagos - totalEgresos).toFixed(2)}`;
    const ctx = document.getElementById('chart');
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Ingresos', 'Egresos'],
        datasets: [{ data: [totalPagos, totalEgresos], backgroundColor: ['#16a34a', '#dc2626'] }]
      }
    });
    loadCumples();
  } catch (err) {
    handleError(err, 'No se pudo cargar el dashboard');
  }
}

async function loadCumples() {
  try {
    const ul = document.getElementById('cumples');
    ul.innerHTML = '';
    const snap = await getDocs(collection(db, 'integrantes'));
    const hoy = new Date();
    const proximos = [];
    snap.forEach(d => {
      const data = d.data();
      if (!data.cumple) return;
      const [year, month, day] = data.cumple.split('-').map(n => parseInt(n));
      let cumple = new Date(hoy.getFullYear(), month - 1, day);
      if (cumple < hoy) cumple.setFullYear(hoy.getFullYear() + 1);
      proximos.push({ nombre: data.nombre, fecha: cumple });
    });
    proximos.sort((a, b) => a.fecha - b.fecha);
    proximos.slice(0, 5).forEach(c => {
      const li = document.createElement('li');
      li.textContent = `${c.nombre} - ${formatDate(c.fecha.toISOString().slice(0,10))}`;
      ul.appendChild(li);
    });
  } catch (err) {
    handleError(err, 'No se pudieron cargar los cumpleaños');
  }
}

// Pagos interactions
cardsPagos?.addEventListener('click', e => {
  const id = e.target.dataset.id;
  if (e.target.classList.contains('ver-detalle')) {
    const pago = pagosData.find(p => p.id === id);
    if (pago) {
      const ul = document.getElementById('lista-historial');
      ul.innerHTML = `<li>Abonado actual: $${(pago.montoAbonado || 0).toFixed(2)}</li>`;
      modalDetalle.classList.remove('hidden');
    }
  } else if (e.target.classList.contains('abonar') && currentRole !== 'consulta') {
    pagoSeleccionado = id;
    document.getElementById('input-abono').value = '';
    modalAbono.classList.remove('hidden');
  }
});

verMasBtn?.addEventListener('click', renderPagos);

document.getElementById('cerrar-detalle')?.addEventListener('click', () => modalDetalle.classList.add('hidden'));
modalDetalle?.addEventListener('click', e => { if (e.target === modalDetalle) modalDetalle.classList.add('hidden'); });

document.getElementById('abono-cancelar')?.addEventListener('click', () => modalAbono.classList.add('hidden'));
modalAbono?.addEventListener('click', e => { if (e.target === modalAbono) modalAbono.classList.add('hidden'); });

document.getElementById('abono-guardar')?.addEventListener('click', async () => {
  const monto = parseFloat(document.getElementById('input-abono').value);
  if (!monto) return toast('Monto inválido');
  try {
    await abonarQuincena(pagoSeleccionado, monto);
    toast('Abono registrado');
    modalAbono.classList.add('hidden');
    loadPagos();
    loadDashboard();
    if (estadoSelect && estadoSelect.value) loadEstado();
  } catch (err) {
    handleError(err, 'No se pudo registrar el abono');
  }
});

btnAbonoGlobal?.addEventListener('click', () => {
  document.getElementById('monto-global').value = '';
  modalAbonoGlobal.classList.remove('hidden');
});

document.getElementById('global-cancelar')?.addEventListener('click', () => modalAbonoGlobal.classList.add('hidden'));
modalAbonoGlobal?.addEventListener('click', e => { if (e.target === modalAbonoGlobal) modalAbonoGlobal.classList.add('hidden'); });

document.getElementById('global-guardar')?.addEventListener('click', async () => {
  const id = document.getElementById('select-integrante').value;
  const monto = parseFloat(document.getElementById('monto-global').value);
  if (!id || !monto) return toast('Datos incompletos');
  try {
    await registrarAbono(id, monto);
    toast('Abono registrado');
    modalAbonoGlobal.classList.add('hidden');
    loadPagos();
    loadDashboard();
    if (estadoSelect && estadoSelect.value) loadEstado();
  } catch (err) {
    handleError(err, 'No se pudo registrar el abono');
  }
});

// Add egreso
const guardarEgreso = document.getElementById('guardar-egreso');
guardarEgreso?.addEventListener('click', async () => {
  try {
    const fecha = document.getElementById('egreso-fecha').value;
    const concepto = document.getElementById('egreso-concepto').value;
    const monto = parseFloat(document.getElementById('egreso-monto').value);
    const detalle = document.getElementById('egreso-detalle').value;
    if (!fecha || !concepto || !monto) return toast('Datos incompletos');
    await addDoc(collection(db, 'egresos'), { fecha, concepto, monto, detalle });
    toast('Egreso registrado');
    loadEgresos();
    loadDashboard();
  } catch (err) {
    handleError(err, 'No se pudo registrar el egreso');
  }
});

// Estado de cuenta
const estadoSelect = document.getElementById('estado-integrante');
const btnExportar = document.getElementById('btn-exportar');
estadoSelect?.addEventListener('change', loadEstado);
btnExportar?.addEventListener('click', () => {
  const elem = document.getElementById('estado-detalle');
  html2pdf().from(elem).save();
});

async function loadEstado() {
  try {
    const id = estadoSelect.value;
    if (!id) return;
    const intDoc = await getDoc(doc(db, 'integrantes', id));
    const ingreso = intDoc.data()?.ingreso || new Date().toISOString().slice(0, 10);
    await ensureQuincenas(id, ingreso);
    const pagosSnap = await getDocs(
      query(collection(db, 'pagos'), where('id_integrante', '==', id), orderBy('fechaLimite'))
    );
    let total = 0;
    const list = [];
    const resumen = { Pagado: 0, Pendiente: 0, Incompleto: 0, Futuro: 0 };
    for (const d of pagosSnap.docs) {
      const p = d.data();
      const estatus = computeEstatus(p.fechaLimite, p.montoAbonado || 0, p.montoEsperado);
      if (estatus !== p.estatus) await updateDoc(d.ref, { estatus });
      resumen[estatus]++;
      total += p.montoAbonado || 0;
      list.push(`<tr><td class='border px-2 py-1'>${p.quincena}</td><td class='border px-2 py-1'>${p.fechaLimite}</td><td class='border px-2 py-1'>$${(p.montoAbonado || 0).toFixed(2)}</td><td class='border px-2 py-1'>${estatus}</td></tr>`);
    }
    const detalle = document.getElementById('estado-detalle');
    detalle.innerHTML = `<table class='min-w-full'><thead><tr><th class='py-1'>Quincena</th><th class='py-1'>Fecha límite</th><th class='py-1'>Abonado</th><th class='py-1'>Estatus</th></tr></thead><tbody>${list.join('')}</tbody></table><p class='mt-2 font-semibold'>Total abonado: $${total.toFixed(2)}</p><p class='mt-2'>Pagadas: ${resumen.Pagado} | Pendientes: ${resumen.Pendiente} | Incompletas: ${resumen.Incompleto} | Futuras: ${resumen.Futuro}</p>`;
  } catch (err) {
    handleError(err, 'No se pudo cargar el estado de cuenta');
  }
}

