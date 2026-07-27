// WhatsApp template interpolation for settings.whatsapp_templates
// ({nombre}, {codigo}, {lote}, {manzana}, {motivo} placeholders).

export interface WhatsappTemplates {
  contacto: string;
  rechazo: string;
}

export const DEFAULT_WA_TEMPLATES: WhatsappTemplates = {
  contacto:
    'Hola {nombre}, te escribimos de Terrenalv sobre tu reserva {codigo} del lote {lote}, manzana {manzana}.',
  rechazo:
    'Hola {nombre}, te escribimos de Terrenalv sobre tu reserva {codigo}. Hubo un problema con tu comprobante: {motivo}. Puedes volver a subirlo desde tu enlace de seguimiento.',
};

export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match);
}
