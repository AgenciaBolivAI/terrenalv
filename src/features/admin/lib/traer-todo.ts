// Traer TODAS las filas de una consulta, sin quedarse en el tope invisible.
//
// PostgREST corta cada respuesta en 1.000 filas y NO avisa: pedir `.limit(5000)`
// devuelve mil y la pantalla cree que ésas son todas. No falla nada, no hay
// error, simplemente faltan filas — que es la peor forma de estar mal.
//
// Ya nos mordió tres veces: la lista de Lotes mostraba 1.000 de los 2.078 que
// el tablero contaba, el constructor de manzanas leía 1.000 lotes para contar
// los que necesitan revisión, y el asistente de CSV comparaba contra 1.000 al
// buscar duplicados — así que un lote repetido más allá de esa fila entraba sin
// que nadie lo notara.
//
// La regla: si la tabla PUEDE pasar de mil filas, se pagina. `lots` tiene 2.078
// vivos hoy; `payments`, `installments` y `audit_log` van en camino.
//
// La consulta tiene que venir ORDENADA por algo estable (una columna única
// alcanza): sin orden, dos páginas pueden traer la misma fila y saltearse otra.

interface Pagina {
  data: unknown;
  error: unknown;
}

export async function traerTodo<T>(
  /** Recibe el rango y devuelve la consulta ya ordenada y acotada con .range(). */
  consulta: (desde: number, hasta: number) => PromiseLike<Pagina>,
  opciones: { pagina?: number; maxPaginas?: number } = {},
): Promise<T[]> {
  const pagina = opciones.pagina ?? 1000;
  // Tope de seguridad: 40 páginas son 40.000 filas. Si una pantalla necesita
  // más que eso, el problema es la pantalla, no la paginación.
  const maxPaginas = opciones.maxPaginas ?? 40;
  const todo: T[] = [];

  for (let i = 0; i < maxPaginas; i += 1) {
    const desde = i * pagina;
    const { data, error } = await consulta(desde, desde + pagina - 1);
    if (error) break;
    const filas = (data ?? []) as T[];
    todo.push(...filas);
    // Una página corta significa que era la última.
    if (filas.length < pagina) break;
  }

  return todo;
}
