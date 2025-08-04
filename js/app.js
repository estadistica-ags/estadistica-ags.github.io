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
  query,
  where,
  orderBy
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

// Views
const loginView = document.getElementById('login-view');
const appView = document.getElementById('app');
const views = document.querySelectorAll('.view');

const loginForm = document.getElementById('login-form');
const logoutBtn = document.getElementById('logout');
const loginError = document.getElementById('login-error');

let currentUser = null;
let currentRole = 'consulta';

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

logoutBtn.addEventListener('click', () => signOut(auth));

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
    const q = query(collection(db, 'integrantes'), where('email', '==', currentUser.email));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const data = snap.docs[0].data();
      currentRole = data.rol;
    }
  } catch (err) {
    handleError(err, 'No se pudo cargar el rol del usuario');
  }
}

// Initialization after login
function initApp() {
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
    document.getElementById('form-pago').classList.remove('hidden');
    document.getElementById('form-egreso').classList.remove('hidden');
    document.getElementById('btn-add-usuario').classList.remove('hidden');
  }
}

// Usuarios
async function loadUsuarios() {
  try {
    const tbody = document.getElementById('tabla-usuarios');
    tbody.innerHTML = '';
    const snap = await getDocs(collection(db, 'integrantes'));
    snap.forEach(doc => {
      const d = doc.data();
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="border px-2 py-1">${d.nombre}</td>
                      <td class="border px-2 py-1">${d.email}</td>
                      <td class="border px-2 py-1">${d.rol}</td>
                      <td class="border px-2 py-1">${d.activo ? 'Sí' : 'No'}</td>`;
      tbody.appendChild(tr);
    });
    const selPago = document.getElementById('pago-integrante');
    const selEstado = document.getElementById('estado-integrante');
    selPago.innerHTML = '<option value="">Integrante</option>';
    selEstado.innerHTML = '';
    snap.forEach(doc => {
      const d = doc.data();
      selPago.innerHTML += `<option value="${doc.id}">${d.nombre}</option>`;
      selEstado.innerHTML += `<option value="${doc.id}">${d.nombre}</option>`;
    });
  } catch (err) {
    handleError(err, 'No se pudieron cargar los usuarios');
  }
}

// Pagos
async function loadPagos() {
  try {
    const tbody = document.getElementById('tabla-pagos');
    tbody.innerHTML = '';
    const snap = await getDocs(collection(db, 'pagos'));
    const integrantes = {};
    const intSnap = await getDocs(collection(db, 'integrantes'));
    intSnap.forEach(d => (integrantes[d.id] = d.data().nombre));
    snap.forEach(doc => {
      const p = doc.data();
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="border px-2 py-1">${integrantes[p.id_integrante] || ''}</td>
                      <td class="border px-2 py-1">${p.quincena}</td>
                      <td class="border px-2 py-1">${p.fechaPago}</td>
                      <td class="border px-2 py-1">$${p.monto.toFixed(2)}</td>`;
      tbody.appendChild(tr);
    });
  } catch (err) {
    handleError(err, 'No se pudieron cargar los pagos');
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
                      <td class="border px-2 py-1">${e.detalle}</td>`;
      tbody.appendChild(tr);
    });
  } catch (err) {
    handleError(err, 'No se pudieron cargar los egresos');
  }
}

// Dashboard
async function loadDashboard() {
  try {
    const pagosSnap = await getDocs(collection(db, 'pagos'));
    const egresosSnap = await getDocs(collection(db, 'egresos'));
    let totalPagos = 0;
    let totalEgresos = 0;
    pagosSnap.forEach(d => (totalPagos += d.data().monto));
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
      if (!data.fechaNacimiento) return;
      const [year, month, day] = data.fechaNacimiento.split('-').map(n => parseInt(n));
      let cumple = new Date(hoy.getFullYear(), month - 1, day);
      if (cumple < hoy) cumple.setFullYear(hoy.getFullYear() + 1);
      proximos.push({ nombre: data.nombre, fecha: cumple });
    });
    proximos.sort((a, b) => a.fecha - b.fecha);
    proximos.slice(0, 5).forEach(c => {
      const li = document.createElement('li');
      li.textContent = `${c.nombre} - ${c.fecha.toISOString().slice(0,10)}`;
      ul.appendChild(li);
    });
  } catch (err) {
    handleError(err, 'No se pudieron cargar los cumpleaños');
  }
}

// Add payment
const guardarPago = document.getElementById('guardar-pago');
guardarPago?.addEventListener('click', async () => {
  try {
    const id = document.getElementById('pago-integrante').value;
    const quincena = document.getElementById('pago-quincena').value;
    const fecha = document.getElementById('pago-fecha').value;
    const monto = parseFloat(document.getElementById('pago-monto').value);
    if (!id || !quincena || !fecha || !monto) return toast('Datos incompletos');
    // prevent duplicate
    const q = query(collection(db, 'pagos'), where('id_integrante', '==', id), where('quincena', '==', quincena));
    const snap = await getDocs(q);
    if (!snap.empty) return toast('Pago duplicado');
    await addDoc(collection(db, 'pagos'), { id_integrante: id, quincena, fechaPago: fecha, monto });
    toast('Pago registrado');
    loadPagos();
    loadDashboard();
  } catch (err) {
    handleError(err, 'No se pudo registrar el pago');
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
    const pagosSnap = await getDocs(
      query(collection(db, 'pagos'), where('id_integrante', '==', id), orderBy('quincena'))
    );
    let total = 0;
    const list = [];
    pagosSnap.forEach(d => {
      const p = d.data();
      total += p.monto;
      list.push(`<tr><td class='border px-2 py-1'>${p.quincena}</td><td class='border px-2 py-1'>${p.fechaPago}</td><td class='border px-2 py-1'>$${p.monto.toFixed(2)}</td></tr>`);
    });
    const detalle = document.getElementById('estado-detalle');
    detalle.innerHTML = `<table class='min-w-full'><thead><tr><th class='py-1'>Quincena</th><th class='py-1'>Fecha</th><th class='py-1'>Monto</th></tr></thead><tbody>${list.join('')}</tbody></table><p class='mt-2 font-semibold'>Total: $${total.toFixed(2)}</p>`;
  } catch (err) {
    handleError(err, 'No se pudo cargar el estado de cuenta');
  }
}

