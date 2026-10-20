// Visor web de la crónica: consume el texto generado por batalla.php.

class Oraculo {
  constructor(contenedor) {
    this.contenedor = contenedor;
    this.lineas = [];
  }

  cargar(texto) {
    this.lineas = texto.split('\n');
    this.renderizar();
  }

  renderizar() {
    this.contenedor.innerHTML = this.lineas.map(formatearLinea).join('');
  }

  filtrarRonda(numero) {
    const marca = '--- Ronda ' + numero + ' ---';
    const inicio = this.lineas.findIndex(l => l.includes(marca));
    if (inicio < 0) return [];
    const fin = this.lineas.findIndex((l, i) => i > inicio && l.includes('--- Ronda'));
    return this.lineas.slice(inicio, fin < 0 ? undefined : fin);
  }
}

function formatearLinea(linea) {
  const clase = esRonda(linea) ? 'ronda' : 'evento';
  return '<p class="' + clase + '">' + linea + '</p>';
}

function esRonda(linea) {
  return linea.includes('--- Ronda');
}

async function cargarCronica(url, oraculo) {
  const respuesta = await fetch(url);
  oraculo.cargar(await respuesta.text());
}
