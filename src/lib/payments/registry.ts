import type { PaymentProvider } from './types';
import { manualQrProvider } from './manual-qr';

const providers: Record<string, PaymentProvider> = {
  manual_qr: manualQrProvider,
  // banco_ganadero: bancoGanaderoProvider,  ← future: new module + secrets + setting flip
  // bnb: bnbProvider,
};

export function getProvider(id: string): PaymentProvider {
  const p = providers[id];
  if (!p) throw new Error(`Proveedor de pago desconocido: ${id}`);
  return p;
}

/** Active provider id comes from settings.payment_provider (env override for staging). */
export function activeProviderId(settingValue: unknown): string {
  return process.env.PAYMENT_PROVIDER ?? (typeof settingValue === 'string' ? settingValue : 'manual_qr');
}
