import type { BuildInstructionsInput, PaymentInstructions, PaymentProvider } from './types';

/**
 * The launch provider: the business's static bank QR + manual screenshot
 * verification. Pure data assembly — DB state moves via the reservation RPCs and
 * the admin verification queue, which acts as this provider's "bank backend".
 */
export const manualQrProvider: PaymentProvider = {
  id: 'manual_qr',
  displayName: 'QR bancario (verificación manual)',
  capabilities: { webhooks: false, polling: false, dynamicQr: false },

  async buildInstructions(input: BuildInstructionsInput): Promise<PaymentInstructions> {
    const s = input.instructionsSetting;
    return {
      kind: 'static_qr',
      qrImageUrl: input.qrImageUrl,
      bankName: s?.bank_name ?? '',
      accountHolder: s?.account_holder ?? '',
      accountMasked: s?.account_masked ?? '',
      amountBob: input.amountBob,
      amountOriginal: input.amount,
      exchangeRateUsed: input.exchangeRateUsed,
      referenceCode: input.referenceCode,
      note: s?.note ?? '',
      requiresProofUpload: true,
    };
  },

  async getPaymentStatus() {
    // Truth lives in our DB for manual QR; callers read the payments row instead.
    return 'pending';
  },
};
