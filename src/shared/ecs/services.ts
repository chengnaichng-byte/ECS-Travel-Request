// Mock ECS core services (§11.1). These expose the SAME shared identifiers used by
// TE (§8.3 guardrails) and are consumed read-only by the pre-trip module. In
// OutSystems these become public server actions of existing ECS core modules; here
// they read the seed reference data in src/data. No CRUD, no maintenance screens
// (§13.18). This is the single boundary through which pre-trip reaches ECS config.

import { employees, type Employee } from '@/data/employees';
import { departments, type Department, ENTITY_ID, ENTITY_NAME } from '@/data/organisation';
import { expenseTypes } from '@/data/expenseTypes';
import { travelPurposes } from '@/data/travelPurposes';
import { countries, cities, airports, flightHoursFromSIN } from '@/data/locations';
import { hotelCaps, hotelCapsByCountry, odaRates, ODA_TRAVEL_DAY_PCT, ODA_FULL_DAY_PCT, ODA_TRAVEL_DAYS } from '@/data/policyRates';
import { travelClasses } from '@/data/travelClass';
import { travelClassRegister, type TravelClassRegisterEntry } from '@/data/travelClassRegister';
import { chargingCodes, type ChargingCode } from '@/data/charging';
import { workflowBands, bandForAmount } from '@/data/workflow';
import { sgdPerUnit, currencies, fxRates } from '@/data/fxRates';
import { tolerances } from '@/data/tolerances';
import { delegations, type Delegation } from '@/data/delegations';
import { rejectionReasons } from '@/data/rejectionReasons';

/* ---------------------------------------------------------------- Identity / HR */
export const EcsIdentity = {
  entity: () => ({ id: ENTITY_ID, name: ENTITY_NAME }),
  employee: (id: string): Employee | undefined => employees.find((e) => e.id === id),
  allEmployees: () => employees,
  department: (id: string): Department | undefined => departments.find((d) => d.id === id),
  allDepartments: () => departments,
  hasRole: (id: string, role: string) => !!employees.find((e) => e.id === id)?.roles.includes(role as never),
  /** RO derivation from reporting line (§2, §13.5). */
  reportingOfficer: (employeeId: string): Employee | undefined => {
    const e = employees.find((x) => x.id === employeeId);
    if (!e?.reportingOfficerId) return undefined;
    return employees.find((x) => x.id === e.reportingOfficerId);
  },
};

/* --------------------------------------------------------------------- Roles */
export const EcsRoles = {
  employeesWithRole: (role: string) => employees.filter((e) => e.roles.includes(role as never)),
};

/* ------------------------------------------------------------ Delegation (§13.13) */
export const EcsDelegation = {
  forDelegate: (delegateId: string): Delegation[] => delegations.filter((d) => d.delegateId === delegateId),
  canCreateTravelRequestFor: (delegateId: string): string[] =>
    delegations.filter((d) => d.delegateId === delegateId && d.kind === 'CREATE_TRAVEL_REQUEST').map((d) => d.principalId),
  all: () => delegations,
};

/* ------------------------------------------------------------ Reference data */
export const EcsReference = {
  expenseTypes: () => expenseTypes,
  expenseType: (id: string) => expenseTypes.find((t) => t.id === id),
  travelPurposes: () => travelPurposes,
  travelPurpose: (id: string) => travelPurposes.find((p) => p.id === id),
  countries: () => countries,
  cities: () => cities,
  airports: () => airports,
  city: (code: string) => cities.find((c) => c.code === code),
  country: (code: string) => countries.find((c) => c.code === code),
  airport: (code: string) => airports.find((a) => a.code === code),
  travelClasses: () => travelClasses,
  travelClass: (id: string) => travelClasses.find((c) => c.id === id),
  currencies: () => currencies,
  fxRates: () => fxRates,
  flightHours: (destCityCode: string) => flightHoursFromSIN[destCityCode] ?? 12,
  rejectionReasons: () => rejectionReasons,
};

/* --------------------------------------------------------------------- FX (§13.4) */
const fxMonth = (onDate?: Date) => (onDate ? onDate.toISOString().slice(0, 7) : undefined);
export const EcsFx = {
  // §13.4 effective-dated: pass the date (submission/entry) to use that month's rate.
  sgdPerUnit: (currency: string, onDate?: Date) => sgdPerUnit(currency, fxMonth(onDate)),
  toSgd: (amount: number, currency: string, onDate?: Date) => amount * sgdPerUnit(currency, fxMonth(onDate)),
};

/* ---------------------------------------------------------- Policy engine config */
export const EcsPolicy = {
  // §15 resolve the nightly cap: a city-specific cap wins; otherwise fall back to the
  // city's country cap (caps maintained by country, A–Z).
  hotelCap: (cityCode: string) => {
    const city = hotelCaps.find((h) => h.cityCode === cityCode)?.capNightlySgd;
    if (city != null) return city;
    const countryCode = cities.find((c) => c.code === cityCode)?.countryCode;
    return countryCode ? hotelCapsByCountry.find((h) => h.countryCode === countryCode)?.capNightlySgd : undefined;
  },
  hotelCapsByCountry: () => hotelCapsByCountry,
  odaRate: (countryCode: string) => odaRates.find((o) => o.countryCode === countryCode)?.dailyRateSgd,
  tolerances: () => tolerances,
  odaTravelDayPct: ODA_TRAVEL_DAY_PCT,
  odaFullDayPct: ODA_FULL_DAY_PCT,
  odaTravelDays: ODA_TRAVEL_DAYS,
};

/* ------------------------------------------- Travel Class register (§13.19) */
const DEFAULT_CLASS = 'TC-ECO';
export const EcsTravelClassRegister = {
  all: () => travelClassRegister,
  /** Effective register entry for an employee on a given date. */
  entry: (employeeId: string, onDate: Date): TravelClassRegisterEntry | undefined => {
    const iso = onDate.toISOString().slice(0, 10);
    return travelClassRegister.find((r) => r.employeeId === employeeId && r.effectiveFrom <= iso && iso <= r.effectiveTo);
  },
  /** Entitled class for a single leg of the given duration (Economy if the duration
   *  condition is not met, or the employee is absent from the register). */
  entitledForDuration: (employeeId: string, hours: number, onDate: Date): string => {
    const e = EcsTravelClassRegister.entry(employeeId, onDate);
    if (!e) return DEFAULT_CLASS;
    return hours >= e.minHours ? e.entitledClassId : DEFAULT_CLASS;
  },
  /** Overall entitlement across an itinerary = highest per-leg entitlement, plus the
   *  per-leg outcomes (mixed itineraries — §13.20) and a human-readable basis. */
  entitledForItinerary: (
    employeeId: string,
    legs: { durationHours?: number | null; isPersonal?: boolean; destCode?: string }[],
    onDate: Date,
  ): { classId: string; basis: string; perLeg: { destCode?: string; hours: number; classId: string }[] } => {
    const entry = EcsTravelClassRegister.entry(employeeId, onDate);
    const airLegs = legs.filter((l) => !l.isPersonal);
    const perLeg = (airLegs.length ? airLegs : [{ durationHours: 12, destCode: undefined }]).map((l) => {
      const hours = l.durationHours ?? 12;
      return { destCode: l.destCode, hours, classId: EcsTravelClassRegister.entitledForDuration(employeeId, hours, onDate) };
    });
    const rankOf = (id: string) => travelClasses.find((c) => c.id === id)?.rank ?? 1;
    const classId = perLeg.reduce((best, p) => (rankOf(p.classId) > rankOf(best) ? p.classId : best), DEFAULT_CLASS);
    const clsName = (id: string) => travelClasses.find((c) => c.id === id)?.name ?? id;
    const basis = entry
      ? `Register ${entry.policyGroup} — ${clsName(entry.entitledClassId)} for flights ≥ ${entry.minHours}h`
      : 'Default (not in register) → Economy';
    return { classId, basis, perLeg };
  },
  /** Single-destination convenience using the Singapore flight-hours table. */
  entitledForCity: (employeeId: string, destCityCode: string, onDate: Date) =>
    EcsTravelClassRegister.entitledForDuration(employeeId, flightHoursFromSIN[destCityCode] ?? 12, onDate),
  rank: (classId: string) => travelClasses.find((c) => c.id === classId)?.rank ?? 1,
};

/* -------------------------------------------------------------- Charging (§2/§13.7) */
export const EcsCharging = {
  codes: () => chargingCodes,
  code: (code: string): ChargingCode | undefined => chargingCodes.find((c) => c.code === code),
};

/* -------------------------------------------------------------- Workflow (§2.3) */
export const EcsWorkflow = {
  bands: () => workflowBands,
  bandForAmount,
};
