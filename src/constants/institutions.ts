export interface InstitutionInfo {
  name: string; // Full name: "HSBC (Hongkong and Shanghai Banking Corporation)"
  shortName: string; // Display-friendly: "HSBC"
}

export const INSTITUTIONS: InstitutionInfo[] = [
  // US — Major Banks
  { name: 'Bank of America', shortName: 'BoA' },
  { name: 'Capital One', shortName: 'Capital One' },
  { name: 'Chase (JPMorgan Chase)', shortName: 'Chase' },
  { name: 'Citibank', shortName: 'Citi' },
  { name: 'Fifth Third Bank', shortName: 'Fifth Third' },
  { name: 'Huntington National Bank', shortName: 'Huntington' },
  { name: 'KeyBank', shortName: 'KeyBank' },
  { name: 'M&T Bank', shortName: 'M&T' },
  { name: 'PNC Financial Services', shortName: 'PNC' },
  { name: 'Regions Bank', shortName: 'Regions' },
  { name: 'Truist Financial', shortName: 'Truist' },
  { name: 'U.S. Bank', shortName: 'US Bank' },
  { name: 'Wells Fargo', shortName: 'Wells Fargo' },

  // US — Online / Neobanks
  { name: 'Ally Bank', shortName: 'Ally' },
  { name: 'Chime', shortName: 'Chime' },
  { name: 'Discover Bank', shortName: 'Discover' },
  { name: 'Marcus (Goldman Sachs)', shortName: 'Marcus' },
  { name: 'SoFi', shortName: 'SoFi' },
  { name: 'Synchrony Bank', shortName: 'Synchrony' },

  // US — Credit Unions
  { name: 'Navy Federal Credit Union', shortName: 'Navy Federal' },
  { name: 'Pentagon Federal Credit Union', shortName: 'PenFed' },

  // US — Brokerages & Investment
  { name: 'BlackRock', shortName: 'BlackRock' },
  { name: 'Charles Schwab', shortName: 'Schwab' },
  { name: 'E-Trade (Morgan Stanley)', shortName: 'E-Trade' },
  { name: 'Edward Jones', shortName: 'Edward Jones' },
  { name: 'Fidelity Investments', shortName: 'Fidelity' },
  { name: 'Goldman Sachs', shortName: 'Goldman' },
  { name: 'Interactive Brokers', shortName: 'IBKR' },
  { name: 'J.P. Morgan Wealth Management', shortName: 'JP Morgan' },
  { name: 'Merrill Lynch (Bank of America)', shortName: 'Merrill' },
  { name: 'Morgan Stanley', shortName: 'Morgan Stanley' },
  { name: 'State Street Global Advisors', shortName: 'State Street' },
  { name: 'T. Rowe Price', shortName: 'T. Rowe Price' },
  { name: 'TD Ameritrade (Charles Schwab)', shortName: 'TD Ameritrade' },
  { name: 'Vanguard', shortName: 'Vanguard' },

  // US — Crypto
  { name: 'Coinbase', shortName: 'Coinbase' },
  { name: 'Other Crypto Wallet', shortName: 'Crypto Wallet' },
  { name: 'Gemini', shortName: 'Gemini' },
  { name: 'Kraken', shortName: 'Kraken' },

  // Europe
  { name: 'Barclays', shortName: 'Barclays' },
  { name: 'BNP Paribas', shortName: 'BNP' },
  { name: 'Credit Suisse (UBS)', shortName: 'Credit Suisse' },
  { name: 'Deutsche Bank', shortName: 'Deutsche' },
  { name: 'HSBC', shortName: 'HSBC' },
  { name: 'ING Group', shortName: 'ING' },
  { name: 'Lloyds Banking Group', shortName: 'Lloyds' },
  { name: 'NatWest Group', shortName: 'NatWest' },
  { name: 'Revolut', shortName: 'Revolut' },
  { name: 'Santander', shortName: 'Santander' },
  { name: 'Standard Chartered', shortName: 'StanChart' },
  { name: 'UBS', shortName: 'UBS' },

  // Canada
  { name: 'Bank of Montreal', shortName: 'BMO' },
  { name: 'Canadian Imperial Bank of Commerce', shortName: 'CIBC' },
  { name: 'Royal Bank of Canada', shortName: 'RBC' },
  { name: 'Scotiabank', shortName: 'Scotiabank' },
  { name: 'Toronto-Dominion Bank', shortName: 'TD' },

  // Asia-Pacific — China
  { name: 'Agricultural Bank of China', shortName: 'ABC' },
  { name: 'Bank of China', shortName: 'BoC' },
  { name: 'China Construction Bank', shortName: 'CCB' },
  { name: 'Industrial and Commercial Bank of China', shortName: 'ICBC' },

  // Asia-Pacific — Japan
  { name: 'Aeon Bank', shortName: 'Aeon Bank' },
  { name: 'Japan Post Bank (ゆうちょ銀行)', shortName: 'JP Bank' },
  { name: 'Mitsubishi UFJ Financial Group', shortName: 'MUFG' },
  { name: 'Mizuho Financial Group (みずほ)', shortName: 'Mizuho' },
  { name: 'Nomura Holdings', shortName: 'Nomura' },
  { name: 'Rakuten Bank', shortName: 'Rakuten Bank' },
  { name: 'Resona Holdings (りそな)', shortName: 'Resona' },
  { name: 'SBI Shinsei Bank (SBI新生銀行)', shortName: 'Shinsei' },
  { name: 'Seven Bank (セブン銀行)', shortName: 'Seven Bank' },
  { name: 'Shinkin Central Bank (信金中央金庫)', shortName: 'Shinkin' },
  { name: 'Sony Bank', shortName: 'Sony Bank' },
  { name: 'Sumitomo Mitsui Banking Corporation (三井住友)', shortName: 'SMBC' },
  { name: 'Sumitomo Mitsui Trust Holdings', shortName: 'SMTH' },

  // Asia-Pacific — Southeast Asia & Oceania
  { name: 'Commonwealth Bank of Australia', shortName: 'CommBank' },
  { name: 'DBS Bank', shortName: 'DBS' },
  { name: 'Maybank (Malayan Banking)', shortName: 'Maybank' },
  { name: 'OCBC Bank', shortName: 'OCBC' },
  { name: 'United Overseas Bank', shortName: 'UOB' },
  { name: 'Westpac', shortName: 'Westpac' },
];

export const OTHER_INSTITUTION_VALUE = '__other__';

export function getInstitutionByName(name: string): InstitutionInfo | undefined {
  return INSTITUTIONS.find((i) => i.name === name || i.shortName === name);
}
