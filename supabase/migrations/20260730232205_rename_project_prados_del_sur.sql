-- El plano y la maqueta dicen "URBANIZACIÓN CIUDADELA PRADOS DEL SUR".
-- El proyecto se sembró como "Estrellas del Sur", que era el nombre equivocado.
-- La descripción también describía el sitio mal: 250 m² (son 300), "Ruta 9
-- Argentina–Paraguay" (el plano rotula la vía "SANTA CRUZ - CAMIRI") y una mega
-- piscina y un club house que no existen en ninguna parte de la lámina.
update public.projects
   set slug        = 'prados-del-sur',
       name        = 'Prados del Sur',
       description = 'Urbanización Ciudadela Prados del Sur — 88 manzanas con lotes de 300 m² (10 × 30) sobre la carretera Santa Cruz — Camiri, Zanja Honda, municipio de Cabezas, provincia Cordillera, Santa Cruz.'
 where slug = 'estrellas-del-sur';

select slug, name from public.projects;
