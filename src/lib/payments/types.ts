// Payment provider abstraction. The reservation state machine only consumes
// normalized statuses and declarative instructions — providers never render UI
// and the flow never talks to a bank directly. Adding Banco Ganadero / BNB QR
// later = one new module in the registry + secrets + one setting flip.

export type Currency = 'USD' | 'BOB';

export interface Money {
  amount: number;
  currency: Currency;
}

export interface CreateIntentInput {
  reservationId: string;
  referenceCode: string;
  expected: Money;
  expectedBob: Money;
  exchangeRateUsed: number;
  expiresAt: string | null;
  buyer: { fullName: string; ci: string; phone: string };
}

/** Discriminated union the buyer UI renders from. */
export type PaymentInstructions =
  | {
      kind: 'static_qr';
      qrImageUrl: string | null;
      bankName: string;
      accountHolder: string;
      accountMasked: string;
      amountBob: Money;
      amountOriginal: Money;
      exchangeRateUsed: number;
      referenceCode: string;
      note: string;
      requiresProofUpload: true;
    }
  | {
      kind: 'dynamic_qr';
      qrImageBase64: string;
      qrId: string;
      amountBob: Money;
      expiresAt: string;
      requiresProofUpload: false;
    };

export type NormalizedPaymentStatus =
  | 'pending'
  | 'proof_submitted'
  | 'verified'
  | 'rejected'
  | 'expired'
  | 'cancelled';

export interface PaymentProvider {
  readonly id: 'manual_qr' | 'banco_ganadero' | 'bnb';
  readonly displayName: string;
  readonly capabilities: {
    webhooks: boolean;
    polling: boolean;
    dynamicQr: boolean;
  };
  /**
   * For manual_qr the payments row is created inside the create_reservation RPC
   * (same transaction); this method only assembles the renderable instructions.
   * Dynamic-QR providers will call the bank here and must implement a
   * compensating cancel on failure (documented contract for the future module).
   */
  buildInstructions(input: BuildInstructionsInput): Promise<PaymentInstructions>;
  getPaymentStatus(providerRef: string): Promise<NormalizedPaymentStatus>;
}

export interface BuildInstructionsInput {
  referenceCode: string;
  amount: Money;
  amountBob: Money;
  exchangeRateUsed: number;
  instructionsSetting: {
    bank_name: string;
    account_holder: string;
    account_masked: string;
    qr_image_path: string | null;
    note: string;
  } | null;
  /** Signed URL for the stored QR image (minted server-side per request). */
  qrImageUrl: string | null;
}
