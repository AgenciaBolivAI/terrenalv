// La ficha del personal, tal como la pidió la contadora: no solo lo que hace
// falta para pagar la planilla, sino el file completo del dependiente.

export interface Empleado {
  id: string;
  codigo: string;
  nombre_completo: string;
  ci: string | null;
  telefono: string | null;
  correo: string | null;
  cargo: string;
  area: string | null;
  fecha_ingreso: string;
  salario_mensual: number;
  estado: string;
  nota: string | null;
  project_id: string | null;
  centro_costo_id: string | null;
  // Datos personales
  fecha_nacimiento: string | null;
  direccion: string | null;
  nacionalidad: string | null;
  estado_civil: string | null;
  profesion: string | null;
  // Estudios
  estudios_primaria: string | null;
  estudios_secundaria: string | null;
  estudios_tecnicos: string | null;
  estudios_universitarios: string | null;
  // Antecedentes
  experiencia_laboral: string | null;
  referencias: string | null;
  // Emergencia
  contacto_emergencia_nombre: string | null;
  contacto_emergencia_telefono: string | null;
  contacto_emergencia_parentesco: string | null;
  // Seguridad social y banco
  afp: string | null;
  nua: string | null;
  caja_salud: string | null;
  banco: string | null;
  cuenta_bancaria: string | null;
  // Contrato
  tipo_contrato: string | null;
  fecha_fin_contrato: string | null;
}

export interface Documento {
  id: string;
  empleado_id: string;
  tipo: string;
  nombre: string;
  created_at: string;
}

export const TIPO_DOCUMENTO: [string, string][] = [
  ['ci', 'Carnet de identidad'],
  ['contrato', 'Contrato'],
  ['curriculum', 'Currículum'],
  ['titulo', 'Título o certificado'],
  ['afp', 'Alta en la AFP'],
  ['caja_salud', 'Alta en la caja de salud'],
  ['memorandum', 'Memorándum'],
  ['croquis', 'Croquis del domicilio'],
  ['otro', 'Otro'],
];
