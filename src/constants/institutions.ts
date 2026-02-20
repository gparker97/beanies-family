export interface InstitutionInfo {
  name: string; // Full name: "HSBC (Hongkong and Shanghai Banking Corporation)"
  shortName: string; // Display-friendly: "HSBC"
}

export const INSTITUTIONS: InstitutionInfo[] = [
  { name: 'Agricultural Bank of China', shortName: 'ABC' },
  { name: 'Bank of America', shortName: 'BoA' },
  { name: 'Bank of China', shortName: 'BoC' },
  { name: 'Barclays', shortName: 'Barclays' },
  { name: 'BNP Paribas', shortName: 'BNP' },
  { name: 'Citibank', shortName: 'Citi' },
  { name: 'China Construction Bank', shortName: 'CCB' },
  { name: 'DBS Bank', shortName: 'DBS' },
  { name: 'Deutsche Bank', shortName: 'Deutsche' },
  { name: 'Goldman Sachs', shortName: 'Goldman' },
  { name: 'HSBC', shortName: 'HSBC' },
  { name: 'Industrial and Commercial Bank of China', shortName: 'ICBC' },
  { name: 'JPMorgan Chase', shortName: 'JPMorgan' },
  { name: 'Mitsubishi UFJ Financial Group', shortName: 'MUFG' },
  { name: 'Morgan Stanley', shortName: 'Morgan Stanley' },
  { name: 'OCBC Bank', shortName: 'OCBC' },
  { name: 'Royal Bank of Canada', shortName: 'RBC' },
  { name: 'Standard Chartered', shortName: 'StanChart' },
  { name: 'UBS', shortName: 'UBS' },
  { name: 'United Overseas Bank', shortName: 'UOB' },
  { name: 'Wells Fargo', shortName: 'Wells Fargo' },
  { name: 'Westpac', shortName: 'Westpac' },
];

export const OTHER_INSTITUTION_VALUE = '__other__';

export function getInstitutionByName(name: string): InstitutionInfo | undefined {
  return INSTITUTIONS.find((i) => i.name === name || i.shortName === name);
}
