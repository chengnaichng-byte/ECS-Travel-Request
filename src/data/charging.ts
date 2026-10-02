// §13.7 Charging: two department cost centres, two research WBS elements, one
// cross-charge account. Company code / business area / CC / WBS reuse ECS/SAP (§2).
export interface ChargingCode {
  code: string;
  name: string;
  type: 'CC' | 'WBS';
  subType?: 'PROGRAMME' | 'PROJECT';   // §17 WBS sub-type (Programme vs Project element)
  departmentId: string;
  companyCode: string;
  businessArea: string;
  isResearch: boolean;
  active?: boolean;         // §25 inactive (closed) accounts cannot be charged (default: active)
  validTo?: string;         // optional grant/account closure date
  fundingOwnerId?: string;  // §6.2 Funding Owner for cross-charge/research WBS
  crossCharge?: boolean;
}

export const chargingCodes: ChargingCode[] = [
  { code: 'CC-1000', name: 'SCSE Teaching & Operations', type: 'CC',  departmentId: 'SCH-CS', companyCode: '1000', businessArea: 'BA-CS', isResearch: false, active: true },
  { code: 'CC-2000', name: 'RI-AI Operations',           type: 'CC',  departmentId: 'RI-AI',  companyCode: '1000', businessArea: 'BA-AI', isResearch: false, active: true },
  { code: 'WBS-R100', name: 'AI Grant Alpha',            type: 'WBS', subType: 'PROGRAMME', departmentId: 'RI-AI',  companyCode: '1000', businessArea: 'BA-AI', isResearch: true, active: true, fundingOwnerId: 'E-RDOA' },
  { code: 'WBS-R200', name: 'AI Grant Beta',             type: 'WBS', subType: 'PROJECT',   departmentId: 'RI-AI',  companyCode: '1000', businessArea: 'BA-AI', isResearch: true, active: true, fundingOwnerId: 'E-RDIR' },
  { code: 'WBS-R300', name: 'AI Grant Gamma (closed)',   type: 'WBS', subType: 'PROJECT',   departmentId: 'RI-AI',  companyCode: '1000', businessArea: 'BA-AI', isResearch: true, active: false, validTo: '2025-12-31', fundingOwnerId: 'E-RDIR' },
  { code: 'CC-XCHG',  name: 'Cross-Charge Shared Pool',  type: 'CC',  departmentId: 'SCH-CS', companyCode: '1000', businessArea: 'BA-CS', isResearch: false, active: true, crossCharge: true, fundingOwnerId: 'E-DOA' },
];
