// Update the commercial payment terms (settings.financing_plan).
//
// Run: NODE_OPTIONS=--experimental-websocket npx tsx scripts/set-financing.ts
//
// Writes the settings row with the service key. update_setting() would be the
// audited path, but it calls private.assert_admin() and there is no admin JWT
// here; the panel (/admin/configuracion → Plan de pago) remains the normal way
// to change these, and it does audit.

import { createClient } from '@supabase/supabase-js';
import { loadEnv, requireEnv } from './env';

loadEnv();
const supabase = createClient(
  requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
  requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false } },
);

const PLAN = {
  enabled: true,
  down_payment_type: 'fijo',
  down_payment_value: 500,
  // Lots are priced in $us; the entry payment is quoted in bolivianos.
  down_payment_currency: 'BOB',
  months: 120, // hasta 10 años
  annual_interest_pct: 0,
  note: 'Cuota inicial Bs 500 y saldo hasta 10 años, sin banco. El cliente propone su forma de pago.',
};

async function main() {
  const { data: before } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'financing_plan')
    .is('project_id', null)
    .maybeSingle();
  console.log('antes :', JSON.stringify(before?.value));

  const { error } = await supabase
    .from('settings')
    .update({ value: PLAN, is_public: true, updated_at: new Date().toISOString() })
    .eq('key', 'financing_plan')
    .is('project_id', null);
  if (error) {
    console.error('update falló:', error.message);
    process.exit(1);
  }

  const { data: after } = await supabase
    .from('settings')
    .select('value, is_public')
    .eq('key', 'financing_plan')
    .is('project_id', null)
    .maybeSingle();
  console.log('después:', JSON.stringify(after?.value), '| is_public:', after?.is_public);
}

void main();
