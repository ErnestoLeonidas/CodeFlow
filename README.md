# CodeFlow 0.3.6

Extensión experimental para VS Code que representa archivos PHP y JavaScript como un mapa de clases, métodos y funciones.

## Cambios de 0.3.6 — panel de filtros

Botón **⚙ Filtros** en la barra superior:
- **Extensiones**: activar o desactivar `.php`, `.js`, `.mjs`, `.cjs` y `.jsx` (muestra cuántos archivos hay de cada una).
- **Carpetas y archivos**: árbol del proyecto con casillas. Desmarcar una carpeta excluye todo lo que contiene (también los archivos que se agreguen después); se puede buscar, y "Todo"/"Nada" marcan o desmarcan todo.
- **Aplicar** vuelve a analizar el proyecto con los filtros; **Restablecer** vuelve a incluir todo.
- Los filtros se guardan por proyecto y se mantienen al actualizar la extensión. El botón muestra cuántos filtros hay activos.
- Las carpetas `node_modules`, `vendor`, `dist`, `build`, `.git`, `coverage` y `.next` siguen excluidas siempre.

## Cambios de 0.3.5 — líneas

- **Cada lado del nodo es sólo de entradas o sólo de salidas.** El lado toma el rol de la mayoría que lo prefiere por ángulo; las conexiones del otro tipo se mueven al lado vecino más cercano (hasta ~100° de giro) que tenga su mismo rol o esté libre. Si no hay ninguno, comparten lado antes que amontonarse.
- **Líneas rectas cuando los nodos están enfrentados**: si dos puertos quedan casi alineados (1 a 3 celdas de diferencia) se alinean, y la conexión es una sola recta de borde a borde.
- **Sin lazos**: se eliminan las vueltas en forma de círculo que aparecían al corregir desfases pequeños, y se penalizan las vueltas en U (dos quiebres seguidos girando hacia el mismo lado).
- **Tramo recto de salida ajustado al espacio libre** para no chocar con el nodo vecino.
- **Reintento flexible**: si una conexión no encuentra camino, se reintenta permitiendo salir/llegar con más ángulos antes de usar la unión simple.
- **Alineación algo más tolerante** entre nodos vecinos (más líneas rectas).

## Cambios de 0.3.4

**Detección de relaciones entre clases (PHP)** — antes sólo se unían métodos por nombre, así que muchas clases relacionadas quedaban como grupos sueltos:
- `$this->repo->metodo()` se resuelve por el tipo de la propiedad (asignada con `new Clase(...)`, por parámetro tipado del constructor o por `@var Clase`). También desambigua métodos con el mismo nombre en varias clases.
- `Clase::metodo()` y `self::metodo()`.
- `new Clase(...)` dentro de un método une ese método con la clase creada.
- `extends Clase` y `require_once 'Archivo.php'` (este último sólo si las clases no quedaron ya relacionadas).

**Distribución en dos niveles que se hablan entre sí:**
- Dentro de cada clase: stress majorization sólo con sus conexiones internas → grupo compacto, con alineación de filas/columnas.
- Entre clases: stress majorization usando el tamaño real de cada grupo (rectángulo, no círculo). Las clases que se llaman entre sí quedan pegadas, con 150 px de separación; la separación se intercala con el stress para no dejar huecos.
- Cada grupo se refleja (espejo) para que sus métodos miren hacia las clases con que se conectan.
- Los grupos desconectados y la zona "Sin conexiones" se acercan al resto en vez de quedar lejos.

## Cambios de 0.3.3 — nueva distribución de nodos (implementación propia)

Reemplaza el orden en dos niveles (clase por clase y luego entre clases) por un canal único:

1. **Distancias de grafo**: para cada par de nodos se calcula cuántos pasos de conexión los separan.
2. **Stress majorization (SGD)**: todos los nodos se ordenan a la vez para que la distancia en pantalla sea proporcional a esos pasos. Una llamada a otra clase acerca el método concreto (no el centro de su grupo). Los nodos de la misma clase se atraen más y los de clases distintas se separan un poco, para que cada clase siga viéndose agrupada.
3. **Sin superposiciones moviendo lo mínimo**: la separación se intercala con el stress, que vuelve a juntar lo que la separación abre (sin espacios vacíos).
4. **Alineación tipo HOLA**: vecinos casi en la misma fila o columna quedan exactamente alineados, así la línea sale recta.
5. **Empaquetado**: los grupos desconectados y la zona "Sin conexiones" se acomodan pegados al grupo principal, en vez de orbitar lejos.

La clase más conectada queda al centro; en las alineaciones manda la posición de la clase.

## Cambios de 0.3.2

- **Mismo tamaño para todos los nodos** (el de una CLASE, 230×70).
- **La prioridad nace en las clases**: el centro del mapa es la clase más conectada, cada clase queda fija al centro de su grupo y sus conexiones se trazan primero.
- **Líneas sólo en múltiplos de 45°** (0°, 45°, 90°, 135°…).
- **Un único radio para todos los quiebres**, igual al de la esquina del nodo (`CORNER_R` en `media/layout.js`).
- **Se privilegian rutas de ~3 quiebres con uno de 45°** (los quiebres de 45° cuestan menos que los de 90°; más de 3 quiebres se penaliza).
- **Salida recta del borde**: el primer quiebre ocurre a no menos de 3/5 del alto del nodo.
- **Hasta 5 conexiones** por los lados izquierdo/derecho.
- **Sin codos seguidos**: entre dos quiebres siempre hay al menos un diámetro del redondeo.
- **Flechas de entrada y salida del mismo tamaño**.

## Cambios de 0.3.1

- **Lado de entrada/salida según el ángulo** entre los centros de los dos nodos: 315°–45° y 135°–225° por los lados horizontales (derecha/izquierda), 45°–135° y 225°–315° por arriba/abajo.
- **Reparto equitativo desde el centro de cada lado** (ejes 0°, 90°, 180°, 270°). Los lados izquierdo y derecho aceptan como máximo 4 conexiones; las demás salen por arriba o por abajo según dónde esté el otro nodo.
- **Abanico sin cruces**: las conexiones del centro del lado salen más lejos antes de girar y las de los extremos giran antes, de modo que cada cable pasa por fuera de su vecino y continúan en paralelo, a la misma distancia, mientras sea posible.
- Los nodos se alinean a la rejilla para que los puntos de salida queden exactos.

## Cambios de 0.3.0

- **Orden dentro de cada clase por resortes**: los métodos que se llaman entre sí quedan juntos; los que son llamados por varios quedan entre quienes los llaman; los que solo dependen de la clase quedan a su lado. Las conexiones resultan cortas y directas.
- **Racimos que se atraen**: las clases que se llaman entre sí se acercan unas a otras (manteniendo la forma circular desde el centro), lo que acorta los cables largos.
- **Más espacio**: cada nodo reserva aire según cuántas conexiones tiene, y las separaciones entre nodos y entre clases son mayores.
- **Cableado más limpio**: los cables paralelos se mantienen a una celda de distancia, se penalizan los zigzags y los puntos de entrada/salida en un mismo borde quedan más espaciados.
- **Animación del segmentado más lenta** al seleccionar un nodo.
- Al actualizar se recalcula la distribución (no se reutilizan posiciones de versiones anteriores).

## Cambios de 0.2.3

- Distribución radial desde el centro, nodos sin conexiones apartados, cables tipo circuito por cualquier borde, líneas continuas que se segmentan y colorean al seleccionar (dorado = sale, celeste = entra).

## Instalación

`code --install-extension codeflow-map-0.3.6.vsix`

Abre un proyecto y ejecuta `CodeFlow: Abrir mapa de funciones` desde la paleta de comandos.

## Limitaciones

El parser PHP/JS es heurístico, no un analizador semántico completo. En grafos muy densos no siempre es posible evitar todos los cruces de cables, pero el enrutado evita que dos cables compartan el mismo tramo.
