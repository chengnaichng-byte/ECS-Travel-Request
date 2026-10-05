// §7.5 / multi-TMC: the University may contract more than one Travel Management Company.
// This is the provider registry (admin-maintained in production, read-only here). Each
// provider has a scope (destination countries it serves), the booking methods it supports,
// a transport/endpoint, and an adapter key — the only code that differs per provider lives
// in the adapter layer (src/integrations/tmc/adapter.ts). Per the agreed design, a single
// travel request is routed to ONE provider (no split booking across TMCs within a request).
import { BOOKING_METHOD } from '@/shared/enums';

export interface TmcProvider {
  id: string;
  name: string;
  adapterKey: string;                 // selects the provider-specific adapter
  active: boolean;
  scope: 'ALL' | string[];            // destination country codes served ('ALL' = global catch-all)
  bookingMethods: string[];           // booking methods the provider fulfils
  transport: string;                  // mock endpoint / transport config (per provider)
  pnrPrefix: string;                  // provider's booking-reference prefix (demonstrates distinct adapters)
  isDefault?: boolean;                // the catch-all default provider
  highRiskOnly?: boolean;             // specialist desk for high-risk destinations
}

export const tmcProviders: TmcProvider[] = [
  { id: 'TMC-FCM', name: 'FCM Travel (Primary)', adapterKey: 'fcm', active: true, scope: 'ALL', isDefault: true, pnrPrefix: 'FCM',
    bookingMethods: [BOOKING_METHOD.TMCOnline, BOOKING_METHOD.AgentAssisted, BOOKING_METHOD.Offline, BOOKING_METHOD.HostArranged],
    transport: 'sftp://fcm-gateway.example:22 (key: ECS_FCM_2026)' },
  { id: 'TMC-CTC', name: 'CTC Travel (Asia-Pacific)', adapterKey: 'ctc', active: true, scope: ['SG', 'JP', 'KR', 'CN', 'HK', 'MY', 'IN', 'AU'], pnrPrefix: 'CTC',
    bookingMethods: [BOOKING_METHOD.TMCOnline, BOOKING_METHOD.AgentAssisted],
    transport: 'https://api.ctc.example/v2 (OAuth2 client-credentials)' },
  { id: 'TMC-C24', name: 'Crisis24 Specialist Desk', adapterKey: 'crisis24', active: true, scope: 'ALL', highRiskOnly: true, pnrPrefix: 'C24',
    bookingMethods: [BOOKING_METHOD.AgentAssisted, BOOKING_METHOD.Offline],
    transport: 'https://api.crisis24.example/secure (mTLS)' },
];

export function tmcProvider(id: string | null | undefined): TmcProvider | undefined {
  return id ? tmcProviders.find((p) => p.id === id) : undefined;
}
export function activeProviders(): TmcProvider[] {
  return tmcProviders.filter((p) => p.active);
}
export function defaultTmcProvider(): TmcProvider {
  return tmcProviders.find((p) => p.isDefault && p.active) ?? tmcProviders[0];
}
