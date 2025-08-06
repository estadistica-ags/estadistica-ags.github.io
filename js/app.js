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
  deleteDoc,
  setDoc
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';

// Helpers
const toast = msg => {
  Toastify({
    text: msg,
    duration: 3000,
    gravity: 'top',
    position: 'right',
    style: { background: '#2563eb' }
  }).showToast();
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

const formatCumple = str => {
  if (!str) return '';
  if (str.includes('/')) {
    const [d, m] = str.split('/');
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}`;
  }
  const parts = str.split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : str;
};

const formatDateLong = (date, includeYear = true) => {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  const day = d.toLocaleDateString('es-ES', { day: '2-digit' });
  const month = d.toLocaleDateString('es-ES', { month: 'long' });
  const monthCap = month.charAt(0).toUpperCase() + month.slice(1);
  return includeYear
    ? `${day} de ${monthCap} de ${d.getFullYear()}`
    : `${day} de ${monthCap}`;
};

const formatMoney = amount =>
  '$' + Number(amount || 0).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });

const getConceptIcon = concept => {
  const c = concept?.toLowerCase() || '';
  if (c.includes('pastel')) return '🎂';
  if (c.includes('comida') || c.includes('alimento')) return '🍽️';
  if (c.includes('transporte') || c.includes('taxi')) return '🚌';
  return '💸';
};

// Quincena helpers
const MONTO_QUINCENA = 30;
const META_SALDO = 1000; // Meta mensual para barra de progreso

const computeEstatus = (fechaLimite, abonado, esperado) => {
  const hoy = new Date().toISOString().slice(0, 10);
  if (abonado >= esperado) return 'Pagado';
  if (fechaLimite < hoy) return 'Pendiente';
  return 'Futuro';
};

const STATUS_STYLES = {
  Pagado: { icon: '✅', border: 'border-green-500', badge: 'bg-green-500' },
  Pendiente: { icon: '⏳', border: 'border-red-500', badge: 'bg-red-500' },
  Futuro: { icon: '📅', border: 'border-gray-400', badge: 'bg-gray-400' }
};

const registrarAbonoQuincena = async (pagoId, abono) => {
  const ref = doc(db, 'pagos', pagoId);
  await addDoc(collection(ref, 'abonos'), abono);
  const snap = await getDoc(ref);
  const data = snap.data();
  const abonado = (data.montoAbonado || 0) + abono.monto;
  const estatus = computeEstatus(data.fechaLimite, abonado, data.montoEsperado);
  await updateDoc(ref, { montoAbonado: abonado, estatus });
};

const registrarAbono = async (usuarioId, monto) => {
  try {
    let restante = monto;
    const nombre = integrantesMap[usuarioId] || '';
    const hoy = new Date().toISOString().slice(0, 10);
    const snap = await getDocs(query(collection(db, 'pagos'), orderBy('fechaLimite')));
    for (const d of snap.docs) {
      if (restante <= 0) break;
      const data = d.data();
      const falta = data.montoEsperado - (data.montoAbonado || 0);
      if (falta <= 0) continue;
      const aplicar = Math.min(falta, restante);
      restante -= aplicar;
      const tipo = data.fechaLimite > hoy ? 'anticipado' : 'quincenal';
      await registrarAbonoQuincena(d.id, {
        id_usuario: usuarioId,
        nombre,
        monto: aplicar,
        fecha: new Date().toISOString(),
        tipo
      });
    }
  } catch (err) {
    handleError(err, 'No se pudo registrar el abono');
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
let integrantesMap = {};

const cardsPagos = document.getElementById('cards-pagos');
const verMasBtn = document.getElementById('ver-mas');
const modalDetalle = document.getElementById('modal-detalle');
const modalAbono = document.getElementById('modal-abono');
const btnAddPago = document.getElementById('btn-add-pago');
const modalQuincena = document.getElementById('modal-quincena');
const formQuincena = document.getElementById('form-quincena');
const quincenaCancel = document.getElementById('quincena-cancelar');
const quincenaTitle = document.getElementById('quincena-title');
let editingPago = null;

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
mobileMenu?.querySelectorAll('a, button').forEach(el => {
  el.addEventListener('click', () => mobileMenu.classList.add('hidden'));
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
    document.getElementById('egresos-acciones').classList.remove('hidden');
    btnAddPago?.classList.remove('hidden');
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
    document.getElementById('usuario-cumple').value = formatCumple(data.cumple) || '';
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
  if (!nombre || !email || !rol || !activo || !cumple) return toast('Datos incompletos');
  const data = { nombre, email, rol, activo: activo === 'true', cumple };
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
    const cont = document.getElementById('lista-usuarios');
    cont.innerHTML = '';
    const snap = await getDocs(collection(db, 'integrantes'));
    const selPago = document.getElementById('pago-integrante');
    const selEstado = document.getElementById('estado-integrante');
    if (selPago) selPago.innerHTML = '<option value="">Integrante</option>';
    if (selEstado) selEstado.innerHTML = '<option value=""></option>';
    snap.forEach(docu => {
      const d = docu.data();
      const card = document.createElement('div');
      card.className = 'bg-white rounded-xl shadow-md p-4 mb-3 w-full max-w-md mx-auto';
      card.innerHTML = `
        <p class="font-bold">${d.nombre}</p>
        <p class="text-sm"><span class="mr-1">🛡️</span>${d.rol}</p>
        <p class="text-sm"><span class="mr-1">${d.activo ? '✅' : '❌'}</span>Activo: ${d.activo ? 'Sí' : 'No'}</p>
        <p class="text-sm"><span class="mr-1">🎂</span>${formatCumple(d.cumple)}</p>
        ${currentRole === 'admin' ? `
          <div class="mt-4 flex space-x-2">
            <button class="edit-usuario flex-1 bg-blue-600 text-white py-2 rounded" data-id="${docu.id}" data-nombre="${d.nombre}" data-email="${d.email}" data-rol="${d.rol}" data-activo="${d.activo}" data-cumple="${d.cumple}">✏️ Editar</button>
            <button class="delete-usuario flex-1 bg-red-600 text-white py-2 rounded" data-id="${docu.id}">🗑 Eliminar</button>
          </div>
        ` : ''}
      `;
      cont.appendChild(card);
      if (selPago) selPago.innerHTML += `<option value="${docu.id}">${d.nombre}</option>`;
      if (selEstado) selEstado.innerHTML += `<option value="${docu.id}">${d.nombre}</option>`;
    });
  } catch (err) {
    handleError(err, 'No se pudieron cargar los usuarios');
  }
}

document.getElementById('lista-usuarios')?.addEventListener('click', async e => {
  const target = e.target;
  if (target.classList.contains('edit-usuario')) {
    openUsuarioModal({
      id: target.dataset.id,
      nombre: target.dataset.nombre,
      email: target.dataset.email,
      rol: target.dataset.rol,
      activo: target.dataset.activo === 'true',
      cumple: target.dataset.cumple
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

function openPagoModal(data = null) {
  modalQuincena.classList.remove('hidden');
  if (data) {
    editingPago = data.id;
    quincenaTitle.textContent = 'Editar fecha de pago';
    document.getElementById('quincena-id').value = data.quincena;
    document.getElementById('quincena-id').setAttribute('disabled', 'true');
    document.getElementById('quincena-fecha').value = data.fechaLimite;
    document.getElementById('quincena-monto').value = data.montoPorUsuario || MONTO_QUINCENA;
  } else {
    editingPago = null;
    quincenaTitle.textContent = 'Nueva fecha de pago';
    document.getElementById('quincena-id').removeAttribute('disabled');
    formQuincena?.reset();
    document.getElementById('quincena-monto').value = MONTO_QUINCENA;
  }
}

function closePagoModal() {
  modalQuincena.classList.add('hidden');
  formQuincena?.reset();
}

btnAddPago?.addEventListener('click', () => openPagoModal());
quincenaCancel?.addEventListener('click', closePagoModal);
modalQuincena?.addEventListener('click', e => {
  if (e.target === modalQuincena) closePagoModal();
});

formQuincena?.addEventListener('submit', async e => {
  e.preventDefault();
  const id = document.getElementById('quincena-id').value.trim();
  const fecha = document.getElementById('quincena-fecha').value;
  const monto = parseFloat(document.getElementById('quincena-monto').value) || MONTO_QUINCENA;
  if (!id || !fecha) return toast('Datos incompletos');
  try {
    const usuariosSnap = await getDocs(query(collection(db, 'integrantes'), where('activo', '==', true)));
    const montoEsperado = usuariosSnap.size * monto;
    if (editingPago) {
      const ref = doc(db, 'pagos', editingPago);
      const snap = await getDoc(ref);
      const abonado = snap.data().montoAbonado || 0;
      const estatus = computeEstatus(fecha, abonado, montoEsperado);
      await updateDoc(ref, { quincena: id, fechaLimite: fecha, montoPorUsuario: monto, montoEsperado, estatus });
      toast('Quincena actualizada');
    } else {
      await setDoc(doc(db, 'pagos', id), {
        quincena: id,
        fechaLimite: fecha,
        montoPorUsuario: monto,
        montoEsperado,
        montoAbonado: 0,
        estatus: computeEstatus(fecha, 0, montoEsperado)
      });
      toast('Quincena creada');
    }
    closePagoModal();
    loadPagos();
  } catch (err) {
    handleError(err, 'No se pudo guardar la quincena');
  }
});

// Pagos
async function loadPagos() {
  try {
    cardsPagos.innerHTML = '';
    pagosData = [];
    pagosMostrados = 0;
    integrantesMap = {};
    const usuariosSnap = await getDocs(query(collection(db, 'integrantes'), where('activo', '==', true)));
    const activeUsers = usuariosSnap.size;
    usuariosSnap.forEach(d => {
      const data = d.data();
      integrantesMap[d.id] = data.nombre;
    });
    const selGlobal = document.getElementById('select-integrante');
    if (selGlobal) {
      selGlobal.innerHTML = '<option value="">Usuario</option>';
      Object.entries(integrantesMap).forEach(([id, nombre]) => {
        selGlobal.innerHTML += `<option value="${id}">${nombre}</option>`;
      });
    }
    const snap = await getDocs(collection(db, 'pagos'));
    snap.forEach(docu => {
      const p = docu.data();
      const montoPorUsuario = p.montoPorUsuario || MONTO_QUINCENA;
      let montoEsperado = p.montoEsperado;
      if (!montoEsperado) {
        montoEsperado = activeUsers * montoPorUsuario;
        updateDoc(docu.ref, { montoEsperado });
      }
      const estatus = computeEstatus(p.fechaLimite, p.montoAbonado || 0, montoEsperado);
      if (estatus !== p.estatus) updateDoc(docu.ref, { estatus });
      pagosData.push({ id: docu.id, ...p, montoPorUsuario, montoEsperado, estatus });
    });
    pagosData.sort((a, b) => new Date(a.fechaLimite) - new Date(b.fechaLimite));
    renderPagos();
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
    card.className = `pago-card bg-white rounded-lg shadow border-l-4 ${info.border}`;
    card.dataset.id = p.id;
    card.dataset.cuota = p.montoPorUsuario || MONTO_QUINCENA;
    card.dataset.fecha = p.fechaLimite;
    card.innerHTML = `
      <div class="header p-4 flex justify-between items-center cursor-pointer">
        <div>
          <h3 class="font-bold">${p.quincena}</h3>
          <p class="text-sm text-gray-600">Fecha límite: ${formatDateLong(p.fechaLimite)}</p>
          <p class="text-sm text-gray-600">Monto esperado: ${formatMoney(p.montoEsperado)}</p>
          <p class="text-sm text-gray-600 monto-abonado">Monto abonado: ${formatMoney(p.montoAbonado || 0)}</p>
        </div>
        <div class="flex items-center space-x-2">
          <span class="badge text-xs text-white px-2 py-1 rounded ${info.badge}">${p.estatus}</span>
          ${currentRole === 'admin' ? `<button class="edit-pago" data-id="${p.id}">✏️</button><button class="delete-pago" data-id="${p.id}">🗑️</button>` : ''}
        </div>
      </div>
      <div class="usuarios hidden border-t p-2 max-h-60 overflow-y-auto"></div>
    `;
    card.querySelector('.header').addEventListener('click', () => toggleUsuarios(card, p));
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
    let total = 0;
    snap.forEach(doc => {
      const e = doc.data();
      total += e.monto;
      const icon = getConceptIcon(e.concepto);
      const tr = document.createElement('tr');
      tr.className = 'border-b even:bg-gray-50';
      tr.innerHTML =
        `<td class="px-4 py-2">${e.fecha}</td>` +
        `<td class="px-4 py-2 flex items-center"><span class="mr-1">${icon}</span>${e.concepto}</td>` +
        `<td class="px-4 py-2">${formatMoney(e.monto)}</td>` +
        (currentRole === 'admin'
          ? `<td class="px-4 py-2 space-x-2"><button class="edit-egreso text-blue-600" data-id="${doc.id}" data-fecha="${e.fecha}" data-concepto="${e.concepto}" data-monto="${e.monto}">✏️</button><button class="delete-egreso text-red-600" data-id="${doc.id}">🗑</button></td>`
          : '');
      tbody.appendChild(tr);
    });
    const tfoot = document.getElementById('tfoot-egresos');
    tfoot.innerHTML = `<tr class="font-semibold"><td colspan="2" class="px-4 py-2 text-right">Total</td><td class="px-4 py-2">${formatMoney(total)}</td>${currentRole === 'admin' ? '<td></td>' : ''}</tr>`;
  } catch (err) {
    handleError(err, 'No se pudieron cargar los egresos');
  }
}

document.getElementById('tabla-egresos')?.addEventListener('click', async e => {
  if (e.target.classList.contains('edit-egreso')) {
    const { id, fecha, concepto, monto } = e.target.dataset;
    const nuevaFecha = prompt('Fecha', fecha) || fecha;
    const nuevoConcepto = prompt('Concepto', concepto) || concepto;
    const nuevoMontoStr = prompt('Monto', monto) || monto;
    const nuevoMonto = parseFloat(nuevoMontoStr);
    if (isNaN(nuevoMonto) || nuevoMonto <= 0) return toast('Monto inválido');
    try {
      await updateDoc(doc(db, 'egresos', id), { fecha: nuevaFecha, concepto: nuevoConcepto, monto: nuevoMonto });
      toast('Egreso actualizado');
      loadEgresos();
      loadDashboard();
    } catch (err) {
      handleError(err, 'No se pudo actualizar el egreso');
    }
  } else if (e.target.classList.contains('delete-egreso')) {
    const id = e.target.dataset.id;
    if (!confirm('¿Eliminar egreso?')) return;
    try {
      await deleteDoc(doc(db, 'egresos', id));
      toast('Egreso eliminado');
      loadEgresos();
      loadDashboard();
    } catch (err) {
      handleError(err, 'No se pudo eliminar el egreso');
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
    document.getElementById('total-ingresos').textContent = formatMoney(totalPagos);
    document.getElementById('total-egresos').textContent = formatMoney(totalEgresos);
    const saldo = totalPagos - totalEgresos;
    document.getElementById('saldo').textContent = formatMoney(saldo);
    const progreso = Math.max(0, Math.min(100, (saldo / META_SALDO) * 100));
    document.getElementById('saldo-progress').style.width = `${progreso}%`;
    document.getElementById('saldo-meta').textContent = `Meta mensual: ${formatMoney(META_SALDO)}`;
    loadCumples();
  } catch (err) {
    handleError(err, 'No se pudo cargar el dashboard');
  }
}

async function loadCumples() {
  try {
    const cont = document.getElementById('cumples');
    cont.innerHTML = '';
    const snap = await getDocs(collection(db, 'integrantes'));
    const hoy = new Date();
    const proximos = [];
    snap.forEach(d => {
      const data = d.data();
      if (!data.cumple) return;
      let day, month;
      if (data.cumple.includes('/')) {
        [day, month] = data.cumple.split('/').map(n => parseInt(n));
      } else {
        const parts = data.cumple.split('-');
        month = parseInt(parts[1]);
        day = parseInt(parts[2]);
      }
      let cumple = new Date(hoy.getFullYear(), month - 1, day);
      if (cumple < hoy) cumple.setFullYear(hoy.getFullYear() + 1);
      proximos.push({ nombre: data.nombre, fecha: cumple });
    });
    proximos.sort((a, b) => a.fecha - b.fecha);
    proximos.slice(0, 5).forEach(c => {
      const card = document.createElement('div');
      card.className = 'w-full max-w-md mx-auto bg-yellow-100 rounded-xl shadow-md p-4 mb-3 flex items-center space-x-4';
      card.innerHTML = `
        <span class="text-3xl">🎂</span>
        <div>
          <p class="font-bold">${c.nombre}</p>
          <p class="text-sm">${formatDateLong(c.fecha, false)}</p>
        </div>
      `;
      cont.appendChild(card);
    });
  } catch (err) {
    handleError(err, 'No se pudieron cargar los cumpleaños');
  }
}

// Pagos interactions
cardsPagos?.addEventListener('change', async e => {
  if (e.target.classList.contains('toggle-pago')) {
    const uid = e.target.dataset.uid;
    const card = e.target.closest('.pago-card');
    const pagoId = card.dataset.id;
    const nombre = integrantesMap[uid] || '';
    const cuota = parseFloat(card.dataset.cuota) || MONTO_QUINCENA;
    const hoy = new Date().toISOString().slice(0, 10);
    const tipo = card.dataset.fecha > hoy ? 'anticipado' : 'quincenal';
    try {
      const ref = doc(db, 'pagos', pagoId, 'abonos', uid);
      if (e.target.checked) {
        await setDoc(ref, { id_usuario: uid, nombre, monto: cuota, fecha: new Date().toISOString(), tipo });
      } else {
        await deleteDoc(ref);
      }
      await recalcPago(pagoId, card);
    } catch (err) {
      handleError(err, 'No se pudo actualizar el abono');
    }
  }
});

cardsPagos?.addEventListener('click', async e => {
  if (e.target.classList.contains('edit-pago')) {
    e.stopPropagation();
    const id = e.target.dataset.id;
    const pago = pagosData.find(p => p.id === id);
    openPagoModal(pago);
  } else if (e.target.classList.contains('delete-pago')) {
    e.stopPropagation();
    const id = e.target.dataset.id;
    if (confirm('¿Eliminar quincena?')) {
      try {
        await deleteDoc(doc(db, 'pagos', id));
        loadPagos();
      } catch (err) {
        handleError(err, 'No se pudo eliminar la quincena');
      }
    }
  }
}, true);

verMasBtn?.addEventListener('click', renderPagos);

async function toggleUsuarios(card, pago) {
  const cont = card.querySelector('.usuarios');
  if (!cont.classList.contains('hidden')) {
    cont.classList.add('hidden');
    return;
  }
  cont.classList.remove('hidden');
  if (cont.dataset.loaded) return;
  const abonados = {};
  const snap = await getDocs(collection(db, 'pagos', pago.id, 'abonos'));
  snap.forEach(a => { abonados[a.id] = a.data(); });
  cont.innerHTML = '';
  Object.entries(integrantesMap).forEach(([uid, nombre]) => {
    const abono = abonados[uid];
    cont.innerHTML += `
      <div class="flex items-center justify-between py-2 border-b last:border-b-0">
        <div>
          <p class="font-medium">${nombre}</p>
          ${abono ? `<p class="text-xs text-gray-500">${formatMoney(abono.monto)} - ${formatDate(abono.fecha.slice(0,10))}</p>` : '<p class="text-xs text-gray-400">Pendiente</p>'}
        </div>
        <input type="checkbox" class="toggle-pago" data-uid="${uid}" ${abono ? 'checked' : ''}/>
      </div>
    `;
  });
  cont.dataset.loaded = 'true';
}

async function recalcPago(pagoId, card) {
  const ref = doc(db, 'pagos', pagoId);
  const snap = await getDoc(ref);
  const data = snap.data();
  let montoAbonado = 0;
  const abonosSnap = await getDocs(collection(ref, 'abonos'));
  abonosSnap.forEach(a => { montoAbonado += a.data().monto; });
  const estatus = computeEstatus(data.fechaLimite, montoAbonado, data.montoEsperado);
  await updateDoc(ref, { montoAbonado, estatus });
  const info = STATUS_STYLES[estatus] || STATUS_STYLES.Futuro;
  card.querySelector('.monto-abonado').textContent = `Monto abonado: ${formatMoney(montoAbonado)}`;
  const badge = card.querySelector('.badge');
  badge.textContent = estatus;
  badge.className = `badge text-xs text-white px-2 py-1 rounded ${info.badge}`;
  card.className = `pago-card bg-white rounded-lg shadow border-l-4 ${info.border}`;
}

// Add egreso
const formEgreso = document.getElementById('egreso-form');
formEgreso?.addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const fecha = document.getElementById('egreso-fecha').value;
    const concepto = document.getElementById('egreso-concepto').value.trim();
    const monto = parseFloat(document.getElementById('egreso-monto').value);
    if (!fecha || !concepto || isNaN(monto) || monto <= 0) return toast('Datos incompletos o monto inválido');
    await addDoc(collection(db, 'egresos'), { fecha, concepto, monto });
    toast('Egreso registrado');
    formEgreso.reset();
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
btnExportar?.addEventListener('click', async () => {
  const detalle = document.getElementById('estado-detalle');
  const nombre = integrantesMap[estadoSelect.value] || '';
  const fecha = formatDateLong(new Date());
  const wrapper = document.createElement('div');
  wrapper.className = 'p-4';
  const header = document.createElement('div');
  header.className = 'mb-4 text-center';
  header.innerHTML = `<h2 class="text-xl font-bold">Estado de cuenta</h2><p>${nombre} - ${fecha}</p>`;
  wrapper.appendChild(header);
  const tabla = detalle.cloneNode(true);
  tabla.id = '';
  wrapper.appendChild(tabla);
  document.body.appendChild(wrapper);
  try {
    await html2pdf().set({ margin: 10 }).from(wrapper).save();
  } catch (err) {
    handleError(err, 'No se pudo exportar el PDF');
  } finally {
    wrapper.remove();
  }
});

async function loadEstado() {
  try {
    const id = estadoSelect.value;
    if (!id) return;
    const pagosSnap = await getDocs(query(collection(db, 'pagos'), orderBy('fechaLimite')));
    let total = 0;
    const list = [];
    const resumen = { Pagado: 0, Pendiente: 0, Futuro: 0 };
    for (const d of pagosSnap.docs) {
      const p = d.data();
      let abonado = 0;
      const abonosSnap = await getDocs(query(collection(db, 'pagos', d.id, 'abonos'), where('id_usuario', '==', id)));
      abonosSnap.forEach(a => (abonado += a.data().monto));
      const estatus = computeEstatus(p.fechaLimite, abonado, p.montoPorUsuario || MONTO_QUINCENA);
      resumen[estatus]++;
      total += abonado;
      list.push(`<tr><td class='border px-2 py-1'>${p.quincena}</td><td class='border px-2 py-1'>${p.fechaLimite}</td><td class='border px-2 py-1'>${formatMoney(abonado)}</td><td class='border px-2 py-1'>${estatus}</td></tr>`);
    }
    const detalle = document.getElementById('estado-detalle');
    detalle.innerHTML = `<table class='min-w-full'><thead><tr><th class='py-1'>Quincena</th><th class='py-1'>Fecha límite</th><th class='py-1'>Abonado</th><th class='py-1'>Estatus</th></tr></thead><tbody>${list.join('')}</tbody></table><p class='mt-2 font-semibold'>Total abonado: ${formatMoney(total)}</p><p class='mt-2'>Pagadas: ${resumen.Pagado} | Pendientes: ${resumen.Pendiente} | Futuras: ${resumen.Futuro}</p>`;
  } catch (err) {
    handleError(err, 'No se pudo cargar el estado de cuenta');
  }
}

